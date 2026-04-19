import { execOnNode, NODES } from '../ssh/sshManager.js';

// ─── Thresholds ────────────────────────────────────────────────────────────────
export const THRESHOLDS = {
  GPU_TEMP_WARNING: 75,
  GPU_TEMP_CRITICAL: 85,
  CPU_TEMP_WARNING: 70,
  CPU_TEMP_CRITICAL: 80,
  RAM_WARNING: 85,
  RAM_CRITICAL: 95,
  VRAM_WARNING: 90,
  ZOMBIE_CONSECUTIVE_POLLS: 60
};

const gpuUtilHistory = new Map();
const networkHistory = new Map(); // Store previous network stats for rate calculation

// ─── GPU Metrics ───────────────────────────────────────────────────────────────
export async function fetchGPUMetrics(nodeId) {
  const queries = [
    'index','name','temperature.gpu','fan.speed',
    'utilization.gpu','utilization.memory',
    'memory.used','memory.free','memory.total',
    'power.draw','power.limit',
    'clocks.current.sm','clocks.max.sm',
    'pcie.link.gen.current','pstate'
  ].join(',');

  const gpuCmd = `nvidia-smi --query-gpu=${queries} --format=csv,noheader,nounits`;
  const procCmd = `nvidia-smi --query-compute-apps=pid,used_memory,gpu_uuid --format=csv,noheader,nounits`;
  const uuidCmd = `nvidia-smi --query-gpu=index,uuid --format=csv,noheader,nounits`;

  try {
    const [gpuOut, procOut, uuidOut] = await Promise.all([
      execOnNode(nodeId, gpuCmd),
      execOnNode(nodeId, procCmd),
      execOnNode(nodeId, uuidCmd)
    ]);

    const uuidToIndex = {};
    for (const line of uuidOut.split('\n').filter(Boolean)) {
      const [idx, uuid] = line.split(', ');
      uuidToIndex[uuid?.trim()] = parseInt(idx?.trim());
    }

    const gpus = gpuOut.split('\n').filter(Boolean).map((line) => {
      const parts = line.split(', ').map(s => s.trim());
      const temp = parseInt(parts[2]);
      const memUsed = parseInt(parts[6]);
      const memTotal = parseInt(parts[8]);
      const utilGpu = parseInt(parts[4]);
      const memPercent = Math.round((memUsed / memTotal) * 100);
      const thermalStatus =
        temp >= THRESHOLDS.GPU_TEMP_CRITICAL ? 'critical' :
        temp >= THRESHOLDS.GPU_TEMP_WARNING  ? 'warning' : 'normal';
      return {
        index: parseInt(parts[0]),
        name: parts[1],
        tempC: isNaN(temp) ? null : temp,
        fanSpeedPct: parseInt(parts[3]) || null,
        utilizationGpuPct: isNaN(utilGpu) ? 0 : utilGpu,
        utilizationMemPct: parseInt(parts[5]) || 0,
        memUsedMiB: isNaN(memUsed) ? 0 : memUsed,
        memFreeMiB: parseInt(parts[7]) || 0,
        memTotalMiB: isNaN(memTotal) ? 1 : memTotal,
        memUsedPct: memPercent,
        powerDrawW: parseFloat(parts[9]) || null,
        powerLimitW: parseFloat(parts[10]) || null,
        clockSMMhz: parseInt(parts[11]) || null,
        clockSMMaxMhz: parseInt(parts[12]) || null,
        pcieGen: parts[13],
        perfState: parts[14],
        thermalStatus,
        isCritical: thermalStatus === 'critical',
        thermalMissionCritical: NODES[nodeId]?.specs?.gpuThermalCritical || false
      };
    });

    const processVram = procOut.split('\n').filter(Boolean).map(line => {
      const parts = line.split(', ').map(s => s.trim());
      return {
        pid: parseInt(parts[0]),
        vramUsedMiB: parseInt(parts[1]) || 0,
        gpuIndex: uuidToIndex[parts[2]] ?? null
      };
    }).filter(p => !isNaN(p.pid));

    return { gpus, processVram };
  } catch (err) {
    console.error(`[Monitoring] GPU fetch failed for ${nodeId}:`, err.message);
    return { gpus: [], processVram: [], error: err.message };
  }
}

// ─── System Metrics ────────────────────────────────────────────────────────────
export async function fetchSystemMetrics(nodeId) {
  const cmd = `echo "=CPU_USAGE="
top -bn2 -d 0.5 | grep '%Cpu' | tail -1 | awk '{print $2}' | sed 's/us,//g'
echo "=LOAD_AVG="
cat /proc/loadavg
echo "=MEM="
free -m | awk 'NR==2{print $2,$3,$4,$6}'
echo "=SWAP="
free -m | awk 'NR==3{print $2,$3,$4}'
echo "=UPTIME="
uptime -p
echo "=CPU_COUNT="
nproc
echo "=HOSTNAME="
hostname -f
echo "=NETWORK="
cat /proc/net/dev | grep -E 'eth0|ens|enp' | head -1 | awk '{print $1,$2,$10}'`;

  try {
    const output = await execOnNode(nodeId, cmd);
    return parseSystemOutput(output, nodeId);
  } catch (err) {
    console.error(`[Monitoring] System metrics failed for ${nodeId}:`, err.message);
    return { error: err.message };
  }
}

function parseSystemOutput(output, nodeId) {
  const sections = {};
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('=') && line.endsWith('=')) {
      current = line.slice(1, -1);
      sections[current] = [];
    } else if (current && line.trim()) {
      sections[current].push(line.trim());
    }
  }
  const [memTotal, memUsed, memFree, memCached] = (sections['MEM']?.[0] || '0 0 0 0').split(' ').map(Number);
  const [swapTotal, swapUsed] = (sections['SWAP']?.[0] || '0 0 0').split(' ').map(Number);
  const loadParts = (sections['LOAD_AVG']?.[0] || '0 0 0').split(' ');
  const memUsedPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0;

  // Parse network stats
  let networkRxBytesPerSec = 0;
  let networkTxBytesPerSec = 0;
  if (sections['NETWORK']?.[0]) {
    const netParts = sections['NETWORK'][0].split(' ');
    const iface = netParts[0]?.replace(':', '');
    const rxBytes = parseInt(netParts[1]) || 0;
    const txBytes = parseInt(netParts[2]) || 0;

    const now = Date.now();
    const prev = networkHistory.get(nodeId);

    if (prev && (now - prev.timestamp) > 0) {
      const timeDiffSec = (now - prev.timestamp) / 1000;
      networkRxBytesPerSec = Math.max(0, (rxBytes - prev.rxBytes) / timeDiffSec);
      networkTxBytesPerSec = Math.max(0, (txBytes - prev.txBytes) / timeDiffSec);
    }

    networkHistory.set(nodeId, { rxBytes, txBytes, timestamp: now, iface });
  }

  return {
    cpuUsagePct: parseFloat(sections['CPU_USAGE']?.[0] || '0'),
    loadAvg1: parseFloat(loadParts[0]) || 0,
    loadAvg5: parseFloat(loadParts[1]) || 0,
    loadAvg15: parseFloat(loadParts[2]) || 0,
    memTotalMiB: memTotal,
    memUsedMiB: memUsed,
    memFreeMiB: memFree,
    memCachedMiB: memCached,
    memUsedPct,
    swapTotalMiB: swapTotal,
    swapUsedMiB: swapUsed,
    uptime: sections['UPTIME']?.[0] || 'unknown',
    cpuCount: parseInt(sections['CPU_COUNT']?.[0] || '0'),
    hostname: sections['HOSTNAME']?.[0] || 'unknown',
    networkRxBytesPerSec,
    networkTxBytesPerSec,
    memStatus: memUsedPct >= THRESHOLDS.RAM_CRITICAL ? 'critical' :
               memUsedPct >= THRESHOLDS.RAM_WARNING  ? 'warning' : 'normal'
  };
}

// ─── CPU Temperatures ──────────────────────────────────────────────────────────
export async function fetchCPUTemps(nodeId) {
  const cmd = `sensors -j 2>/dev/null || sensors 2>/dev/null | grep -E "Core|Tdie|Tctl|Package" | head -32`;
  try {
    const output = await execOnNode(nodeId, cmd);
    return parseCPUTemps(output);
  } catch (err) {
    return { cores: [], packageTemp: null, error: err.message };
  }
}

function parseCPUTemps(output) {
  const cores = [];
  let packageTemp = null;
  try {
    const json = JSON.parse(output);
    for (const [, data] of Object.entries(json)) {
      for (const [key, vals] of Object.entries(data)) {
        if (typeof vals === 'object') {
          for (const [subkey, val] of Object.entries(vals)) {
            if (subkey.endsWith('_input')) {
              const temp = parseFloat(val);
              if (!isNaN(temp)) {
                if (key.toLowerCase().includes('core')) cores.push({ label: key, tempC: temp });
                if (key.toLowerCase().includes('package') || key.toLowerCase().includes('tdie')) packageTemp = temp;
              }
            }
          }
        }
      }
    }
  } catch {
    for (const line of output.split('\n')) {
      const match = line.match(/(.+?):\s+\+?(\d+\.\d+)°C/);
      if (match) {
        const temp = parseFloat(match[2]);
        const label = match[1].trim();
        if (label.toLowerCase().includes('core')) cores.push({ label, tempC: temp });
        else if (label.toLowerCase().includes('package')) packageTemp = temp;
      }
    }
  }
  const maxTemp = cores.length ? Math.max(...cores.map(c => c.tempC)) : null;
  return {
    cores, packageTemp, maxCoreTemp: maxTemp,
    thermalStatus: maxTemp
      ? (maxTemp >= THRESHOLDS.CPU_TEMP_CRITICAL ? 'critical' :
         maxTemp >= THRESHOLDS.CPU_TEMP_WARNING  ? 'warning' : 'normal')
      : 'unknown'
  };
}

// ─── Storage Metrics ───────────────────────────────────────────────────────────
export async function fetchStorageMetrics(nodeId) {
  const cmd = `echo "=DF="
df -BGB --output=source,fstype,size,used,avail,pcent,target 2>/dev/null | tail -n+2
echo "=NVME="
lsblk -d -o NAME,TYPE,ROTA,SIZE,MODEL 2>/dev/null | grep -i nvme`;
  try {
    const output = await execOnNode(nodeId, cmd);
    return parseStorageOutput(output);
  } catch (err) {
    return { filesystems: [], nvmeDevices: [], error: err.message };
  }
}

function parseStorageOutput(output) {
  const sections = {};
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('=') && line.endsWith('=')) { current = line.slice(1,-1); sections[current] = []; }
    else if (current && line.trim()) sections[current].push(line.trim());
  }
  const filesystems = (sections['DF'] || [])
    .filter(line => !line.startsWith('tmpfs') && !line.startsWith('udev'))
    .map(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 7) return null;
      const usedPct = parseInt(parts[5]);
      return {
        source: parts[0], fstype: parts[1],
        sizeGB: parseInt(parts[2]), usedGB: parseInt(parts[3]),
        availGB: parseInt(parts[4]), usedPct: isNaN(usedPct) ? 0 : usedPct,
        mountpoint: parts[6],
        isNVMe: parts[0].includes('nvme'),
        status: usedPct >= 90 ? 'critical' : usedPct >= 75 ? 'warning' : 'normal'
      };
    })
    .filter(Boolean)
    .filter(fs => ['/home','/data','/storage','/mnt','/'].some(m => fs.mountpoint.startsWith(m)));
  const nvmeDevices = (sections['NVME'] || []).map(line => {
    const parts = line.split(/\s+/);
    return { name: parts[0], size: parts[3], model: parts.slice(4).join(' ') };
  });
  return { filesystems, nvmeDevices };
}

// ─── Per-User Resource Usage ───────────────────────────────────────────────────
export async function fetchUserResourceUsage(nodeId) {
  const cmd = `echo "=PROCS="
ps aux --no-headers | awk '{print $1,$2,$3,$4,$11}' | head -200`;
  try {
    const output = await execOnNode(nodeId, cmd);
    return parseUserUsage(output);
  } catch (err) {
    return { users: [], error: err.message };
  }
}

function parseUserUsage(output) {
  const sections = {};
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('=') && line.endsWith('=')) { current = line.slice(1,-1); sections[current] = []; }
    else if (current && line.trim()) sections[current].push(line.trim());
  }
  const systemUsers = new Set(['root','daemon','sys','sync','games','man','lp','mail','news',
    'uucp','proxy','www-data','nobody','systemd-network','systemd-resolve','messagebus',
    'syslog','_apt','ntp','postfix','monitor']);
  const userStats = {};
  for (const line of (sections['PROCS'] || [])) {
    const parts = line.split(/\s+/);
    if (parts.length < 4) continue;
    const [user, pid, cpu, mem] = parts;
    if (systemUsers.has(user) || user.startsWith('_')) continue;
    if (!userStats[user]) userStats[user] = { user, cpuPct: 0, memPct: 0, processCount: 0, pids: [] };
    userStats[user].cpuPct += parseFloat(cpu) || 0;
    userStats[user].memPct += parseFloat(mem) || 0;
    userStats[user].processCount++;
    userStats[user].pids.push(parseInt(pid));
  }
  return {
    users: Object.values(userStats)
      .sort((a, b) => b.cpuPct - a.cpuPct)
      .map(u => ({ ...u, cpuPct: Math.round(u.cpuPct*10)/10, memPct: Math.round(u.memPct*10)/10 }))
  };
}

// ─── Heavy Processes ───────────────────────────────────────────────────────────
export async function fetchHeavyProcesses(nodeId) {
  const cmd = `ps aux --no-headers --sort=-%cpu | awk '$3 > 0.5 || $4 > 0.5 {print $1,$2,$3,$4,$8,$9,$11}' | head -60`;
  try {
    const output = await execOnNode(nodeId, cmd);
    return output.split('\n').filter(Boolean).map(line => {
      const parts = line.split(/\s+/);
      const [user, pid, cpu, mem, stat, start, ...cmdParts] = parts;
      const cmdStr = cmdParts.join(' ');
      const isHeavy = ['python','python3','docker','ffmpeg','jupyter','nvcc','torchrun','deepspeed']
        .some(p => cmdStr.toLowerCase().includes(p));
      return {
        user, pid: parseInt(pid), cpuPct: parseFloat(cpu),
        memPct: parseFloat(mem), stat, start, cmd: cmdStr,
        isHeavy, vramMiB: 0, gpuUtilPct: 0, isZombie: false, nodeId
      };
    }).filter(p => !isNaN(p.pid));
  } catch (err) {
    console.error(`[Monitoring] Process fetch failed for ${nodeId}:`, err.message);
    return [];
  }
}

// ─── Zombie Detection ──────────────────────────────────────────────────────────
export function detectZombieProcesses(processes, processVram) {
  const vramMap = new Map(processVram.map(p => [p.pid, p]));
  return processes.map(proc => {
    const vramData = vramMap.get(proc.pid);
    if (vramData) { proc.vramMiB = vramData.vramUsedMiB; proc.gpuIndex = vramData.gpuIndex; }
    const key = `${proc.nodeId}-${proc.pid}`;
    if (proc.vramMiB > 0 && proc.gpuUtilPct === 0) {
      const count = (gpuUtilHistory.get(key) || 0) + 1;
      gpuUtilHistory.set(key, count);
      proc.zombieScore = count;
      proc.isZombie = count >= THRESHOLDS.ZOMBIE_CONSECUTIVE_POLLS;
      proc.zombieMinutes = Math.round((count * 5) / 60 * 10) / 10;
    } else {
      gpuUtilHistory.delete(key);
      proc.zombieScore = 0;
      proc.isZombie = false;
    }
    return proc;
  });
}

export function cleanupZombieHistory(activeProcesses) {
  const activePids = new Set(activeProcesses.map(p => `${p.nodeId}-${p.pid}`));
  for (const key of gpuUtilHistory.keys()) {
    if (!activePids.has(key)) gpuUtilHistory.delete(key);
  }
}

// ─── Full Node Snapshot ────────────────────────────────────────────────────────
export async function fetchFullNodeSnapshot(nodeId) {
  const [gpu, system, cpuTemps, storage, userUsage, processes, ports, sshSessions] =
    await Promise.allSettled([
      fetchGPUMetrics(nodeId),
      fetchSystemMetrics(nodeId),
      fetchCPUTemps(nodeId),
      fetchStorageMetrics(nodeId),
      fetchUserResourceUsage(nodeId),
      fetchHeavyProcesses(nodeId),
      fetchOpenPortsEnriched(nodeId),
      fetchSSHSessions(nodeId)
    ]);

  const gpuData  = gpu.status      === 'fulfilled' ? gpu.value      : { gpus: [], processVram: [], error: gpu.reason?.message };
  const procData = processes.status === 'fulfilled' ? processes.value : [];

  const enrichedProcs = detectZombieProcesses(procData, gpuData.processVram || []);
  cleanupZombieHistory(enrichedProcs);

  const userVramMap = {};
  for (const p of enrichedProcs) {
    if (p.vramMiB > 0 && p.user) userVramMap[p.user] = (userVramMap[p.user] || 0) + p.vramMiB;
  }

  const userData   = userUsage.status  === 'fulfilled' ? userUsage.value  : { users: [] };
  const usersWithVram = userData.users.map(u => ({ ...u, vramMiB: userVramMap[u.user] || 0 }));

  const sysData    = system.status    === 'fulfilled' ? system.value    : { error: system.reason?.message };
  const portsData  = ports.status     === 'fulfilled' ? ports.value     : { ports: [], error: ports.reason?.message };
  const sshData    = sshSessions.status === 'fulfilled' ? sshSessions.value : [];

  const alerts = generateAlerts(nodeId, gpuData.gpus, sysData);

  return {
    nodeId,
    nodeLabel: NODES[nodeId]?.label,
    timestamp: new Date().toISOString(),
    gpu: gpuData,
    system: sysData,
    cpuTemps: cpuTemps.status === 'fulfilled' ? cpuTemps.value : { error: cpuTemps.reason?.message },
    storage:  storage.status  === 'fulfilled' ? storage.value  : { error: storage.reason?.message },
    users: usersWithVram,
    processes: enrichedProcs.sort((a, b) => (b.vramMiB - a.vramMiB) || (b.cpuPct - a.cpuPct)),
    openPorts: portsData,
    sshSessions: sshData,
    alerts
  };
}

function generateAlerts(nodeId, gpus, system) {
  const alerts = [];
  const isMissionCritical = NODES[nodeId]?.specs?.gpuThermalCritical;
  for (const gpu of (gpus || [])) {
    if (gpu.isCritical) {
      alerts.push({
        id: `gpu-temp-critical-${nodeId}-${gpu.index}`, type: 'critical', nodeId,
        category: 'thermal',
        message: `GPU ${gpu.index} (${gpu.name}) CRITICAL: ${gpu.tempC}°C${isMissionCritical ? ' — ⚠️ POST-REPAIR MONITORING ACTIVE' : ''}`,
        value: gpu.tempC, threshold: THRESHOLDS.GPU_TEMP_CRITICAL,
        missionCritical: isMissionCritical, timestamp: new Date().toISOString()
      });
    } else if (gpu.thermalStatus === 'warning') {
      alerts.push({
        id: `gpu-temp-warn-${nodeId}-${gpu.index}`, type: 'warning', nodeId,
        category: 'thermal',
        message: `GPU ${gpu.index} (${gpu.name}) Warning: ${gpu.tempC}°C`,
        value: gpu.tempC, threshold: THRESHOLDS.GPU_TEMP_WARNING,
        missionCritical: isMissionCritical, timestamp: new Date().toISOString()
      });
    }
  }
  if (system?.memStatus === 'critical') {
    alerts.push({
      id: `mem-critical-${nodeId}`, type: 'critical', nodeId, category: 'memory',
      message: `RAM usage critical: ${system.memUsedPct}% (${system.memUsedMiB}MB / ${system.memTotalMiB}MB)`,
      value: system.memUsedPct, threshold: THRESHOLDS.RAM_CRITICAL, timestamp: new Date().toISOString()
    });
  }
  return alerts;
}

// ─── Open Ports ────────────────────────────────────────────────────────────────

export async function fetchOpenPorts(nodeId) {
  const cmd = `sudo -n ss -tlnpH 2>/dev/null | awk '{print $1,$4,$6}' | head -60`;
  try {
    const output = await execOnNode(nodeId, cmd);
    return { ports: parseOpenPorts(output) };
  } catch (err) {
    // fallback to netstat with sudo
    try {
      const out2 = await execOnNode(nodeId,
        `sudo -n netstat -tlnp 2>/dev/null | tail -n+3 | awk '{print $1,$4,$7}' | head -60`);
      return { ports: parseNetstatPorts(out2) };
    } catch {
      // final fallback: try without sudo (will only show user's own processes)
      try {
        const out3 = await execOnNode(nodeId,
          `ss -tlnpH 2>/dev/null | awk '{print $1,$4,$6}' | head -60`);
        return { ports: parseOpenPorts(out3) };
      } catch {
        return { ports: [], error: err.message };
      }
    }
  }
}

export async function fetchOpenPortsEnriched(nodeId) {
  const result = await fetchOpenPorts(nodeId);
  if (!result.ports?.length) return result;

  // Enrich with user info via a single ps call
  try {
    const pids = result.ports.filter(p => p.pid).map(p => p.pid).join(',');
    if (pids) {
      // Try with sudo first, fallback to regular ps
      let psCmd = `sudo -n ps -o pid=,user= -p ${pids} 2>/dev/null`;
      let psOut;
      try {
        psOut = await execOnNode(nodeId, psCmd, 5000);
      } catch {
        // Fallback: try without sudo
        psCmd = `ps -o pid=,user= -p ${pids} 2>/dev/null`;
        psOut = await execOnNode(nodeId, psCmd, 5000);
      }

      const pidUserMap = {};
      for (const line of psOut.split('\n').filter(Boolean)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) pidUserMap[parseInt(parts[0])] = parts[1];
      }
      result.ports = result.ports.map(p => ({
        ...p,
        user: (p.pid && pidUserMap[p.pid]) || p.user || 'unknown'
      }));
    }
  } catch (err) {
    console.error(`[Ports] Failed to enrich user info for ${nodeId}:`, err.message);
  }

  return result;
}

function parseOpenPorts(output) {
  const ports = [];
  for (const line of output.split('\n').filter(Boolean)) {
    const addrMatch = line.match(/[\d.:*]+:(\d+)/);
    const procMatch = line.match(/"([^"]+)",pid=(\d+)/);
    if (!addrMatch) continue;
    const port = parseInt(addrMatch[1]);
    if (!port || port === 0) continue;
    const addrFull = line.match(/[\d.*:[\]]+:\d+/)?.[0] || '';
    const isLocal = addrFull.startsWith('127.') || addrFull.startsWith('[::1]');
    ports.push({
      port,
      process: procMatch?.[1] || 'unknown',
      pid: procMatch ? parseInt(procMatch[2]) : null,
      user: 'unknown',
      address: addrFull,
      isLocal,
      protocol: 'tcp'
    });
  }
  return ports.sort((a, b) => a.port - b.port);
}

function parseNetstatPorts(output) {
  const ports = [];
  for (const line of output.split('\n').filter(Boolean)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 3) continue;
    const addrMatch = parts[1]?.match(/:(\d+)$/);
    const procParts = parts[2]?.split('/');
    if (!addrMatch) continue;
    ports.push({
      port: parseInt(addrMatch[1]),
      pid: parseInt(procParts?.[0]) || null,
      process: procParts?.[1] || 'unknown',
      user: 'unknown',
      address: parts[1],
      isLocal: parts[1]?.startsWith('127.'),
      protocol: 'tcp'
    });
  }
  return ports.sort((a, b) => a.port - b.port);
}

// ─── SSH Sessions ──────────────────────────────────────────────────────────────

export async function fetchSSHSessions(nodeId) {
  const cmd = `
    echo "=WHO="
    who | grep pts || true
    echo "=LASTLOG="
    last -n 20 -F 2>/dev/null | grep -v "^$" | grep -v "wtmp" | head -20
  `.replace(/\n\s+/g, '\n').trim();

  try {
    const output = await execOnNode(nodeId, cmd);
    return parseSSHSessions(output);
  } catch (err) {
    return { sessions: [], recentLogins: [], error: err.message };
  }
}

function parseSSHSessions(output) {
  const sections = {};
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('=') && line.endsWith('=')) {
      current = line.slice(1, -1);
      sections[current] = [];
    } else if (current && line.trim()) {
      sections[current].push(line.trim());
    }
  }

  const sessions = (sections['WHO'] || []).map(line => {
    const parts = line.split(/\s+/);
    const ipMatch = line.match(/\(([^)]+)\)/);
    return {
      user: parts[0],
      tty: parts[1],
      loginTime: parts.slice(2, 4).join(' '),
      fromIP: ipMatch?.[1] || 'local',
      isSSH: parts[1]?.startsWith('pts/')
    };
  }).filter(s => s.user);

  const recentLogins = (sections['LASTLOG'] || []).map(line => {
    const parts = line.split(/\s+/);
    if (parts.length < 3 || parts[0] === 'reboot') return null;
    const isActive = line.includes('still logged in');
    return {
      user: parts[0],
      tty: parts[1],
      fromIP: parts[2],
      loginTime: parts.slice(3, 7).join(' '),
      logoutTime: isActive ? 'active' : parts.slice(7).join(' '),
      active: isActive
    };
  }).filter(Boolean).slice(0, 15);

  return { sessions, recentLogins, activeCount: sessions.length };
}

// ─── Per-User Storage Usage ────────────────────────────────────────────────────

// ─── Storage cache — prevents concurrent du calls hammering the servers ──────
const storageCache = {
  node1: { data: null, lastFetch: 0, inFlight: null },
  node2: { data: null, lastFetch: 0, inFlight: null }
};
const STORAGE_CACHE_TTL = 120_000; // 2 minutes

export async function fetchStorageByUser(nodeId) {
  const cache = storageCache[nodeId];
  const now = Date.now();

  // Return cached result if still fresh
  if (cache.data && (now - cache.lastFetch) < STORAGE_CACHE_TTL) {
    console.log(`[Storage] Returning cached result for ${nodeId} (age: ${Math.round((now - cache.lastFetch)/1000)}s)`);
    return cache.data;
  }

  // If a du is already running, wait for it — don't start another
  if (cache.inFlight) {
    console.log(`[Storage] Waiting for in-flight du for ${nodeId}...`);
    return cache.inFlight;
  }

  console.log(`[Storage] Starting du for ${nodeId}...`);

  cache.inFlight = (async () => {
    const cmd = [
      'echo "=HOME="',
      'sudo du -sh /home/*/ 2>/dev/null | sort -rh | head -30',
      'echo "=DATA="',
      'sudo du -sh /data/*/ 2>/dev/null | sort -rh | head -20',
      'echo "=SCRATCH="',
      'sudo du -sh /scratch/*/ 2>/dev/null | sort -rh | head -20'
    ].join('\n');

    try {
      const output = await execOnNode(nodeId, cmd, 60000);
      const result = parseStorageByUser(output, nodeId);

      if (result.users?.length > 0) {
        cache.data = result;
        cache.lastFetch = Date.now();
        console.log(`[Storage] Cached ${result.users.length} users for ${nodeId}`);
      } else {
        console.warn(`[Storage] du returned no users for ${nodeId}. Raw:`, JSON.stringify(output.slice(0, 400)));
      }
      return result;
    } catch (err) {
      console.error(`[Storage] du failed for ${nodeId}:`, err.message);
      if (cache.data) return cache.data; // return stale on error
      return { users: [], error: err.message };
    } finally {
      cache.inFlight = null;
    }
  })();

  return cache.inFlight;
}

function parseStorageByUser(output, nodeId) {
  const sections = {};
  let current = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('=') && line.endsWith('=')) {
      current = line.slice(1, -1);
      sections[current] = [];
    } else if (current && line.trim()) {
      sections[current].push(line.trim());
    }
  }

  const userMap = {};

  const parseDuSection = (lines, mountLabel) => {
    for (const line of (lines || [])) {
      // du output: "13G\t/home/oem/" — tab-separated
      // Try tab split first, then fallback to any whitespace
      let sizeStr, path;
      if (line.includes('\t')) {
        const parts = line.split('\t');
        sizeStr = parts[0].trim();
        path = parts[1]?.trim();
      } else {
        const match = line.trim().match(/^(\S+)\s+(.+)$/);
        if (!match) {
          continue;
        }
        sizeStr = match[1];
        path = match[2];
      }

      if (!sizeStr || !path) continue;
      const username = path.replace(/\/$/, '').split('/').pop();
      if (!username || username === '*' || username === '') continue;
      const bytes = parseSizeToBytes(sizeStr);
      if (bytes === 0) continue;
      if (!userMap[username]) {
        userMap[username] = { user: username, totalBytes: 0, mounts: [] };
      }
      userMap[username].totalBytes += bytes;
      userMap[username].mounts.push({ mount: mountLabel, path, size: sizeStr, bytes });
    }
  };

  parseDuSection(sections['HOME'], '/home');
  parseDuSection(sections['DATA'], '/data');
  parseDuSection(sections['SCRATCH'], '/scratch');

  return {
    users: Object.values(userMap)
      .sort((a, b) => b.totalBytes - a.totalBytes)
      .map(u => ({ ...u, totalFormatted: formatBytesServer(u.totalBytes) })),
    nodeId
  };
}

function parseSizeToBytes(str) {
  if (!str) return 0;
  // Handles: 13G, 536M, 1.2K, 4.0KB, 1.5GB, 512MB etc.
  const match = str.match(/^([\d.]+)\s*([KMGT]?)B?$/i);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return 0;
  const unit = match[2].toUpperCase();
  const mult = { '': 1, 'K': 1024, 'M': 1024 ** 2, 'G': 1024 ** 3, 'T': 1024 ** 4 };
  return Math.round(num * (mult[unit] ?? 1));
}

function formatBytesServer(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}