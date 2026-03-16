import { execOnNode, execOnAllNodes, NODES } from '../ssh/sshManager.js';

// ─── Thresholds ────────────────────────────────────────────────────────────────
export const THRESHOLDS = {
  GPU_TEMP_WARNING: 75,
  GPU_TEMP_CRITICAL: 85,
  CPU_TEMP_WARNING: 70,
  CPU_TEMP_CRITICAL: 80,
  RAM_WARNING: 85,
  RAM_CRITICAL: 95,
  VRAM_WARNING: 90,
  // Zombie: 0% GPU util for this many consecutive polls (each ~5s = 5 min)
  ZOMBIE_CONSECUTIVE_POLLS: 60
};

// Track GPU utilization history to detect zombies
const gpuUtilHistory = new Map(); // key: `${nodeId}-${pid}`, value: zero-util-count

// ─── nvidia-smi Parser ─────────────────────────────────────────────────────────

/**
 * Fetch comprehensive GPU metrics from nvidia-smi.
 */
export async function fetchGPUMetrics(nodeId) {
  const queries = [
    // Per-GPU stats
    'index', 'name', 'temperature.gpu', 'fan.speed',
    'utilization.gpu', 'utilization.memory',
    'memory.used', 'memory.free', 'memory.total',
    'power.draw', 'power.limit',
    'clocks.current.sm', 'clocks.max.sm',
    'pcie.link.gen.current', 'pstate'
  ].join(',');

  const gpuCmd = `nvidia-smi --query-gpu=${queries} --format=csv,noheader,nounits`;

  // Per-process VRAM usage
  const procCmd = `nvidia-smi --query-compute-apps=pid,used_memory,gpu_uuid --format=csv,noheader,nounits`;

  // GPU UUID to index mapping
  const uuidCmd = `nvidia-smi --query-gpu=index,uuid --format=csv,noheader,nounits`;

  try {
    const [gpuOut, procOut, uuidOut] = await Promise.all([
      execOnNode(nodeId, gpuCmd),
      execOnNode(nodeId, procCmd),
      execOnNode(nodeId, uuidCmd)
    ]);

    // Build UUID -> index map
    const uuidToIndex = {};
    for (const line of uuidOut.split('\n').filter(Boolean)) {
      const [idx, uuid] = line.split(', ');
      uuidToIndex[uuid?.trim()] = parseInt(idx?.trim());
    }

    // Parse GPU rows
    const gpus = gpuOut.split('\n').filter(Boolean).map((line, idx) => {
      const parts = line.split(', ').map(s => s.trim());
      const temp = parseInt(parts[2]);
      const memUsed = parseInt(parts[6]);
      const memTotal = parseInt(parts[8]);
      const utilGpu = parseInt(parts[4]);
      const memPercent = Math.round((memUsed / memTotal) * 100);

      const thermalStatus =
        temp >= THRESHOLDS.GPU_TEMP_CRITICAL ? 'critical' :
        temp >= THRESHOLDS.GPU_TEMP_WARNING ? 'warning' : 'normal';

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
        // Flag Node 2 GPUs as requiring extra thermal attention
        thermalMissionCritical: NODES[nodeId]?.specs?.gpuThermalCritical || false
      };
    });

    // Parse per-process VRAM
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

// ─── CPU / System Metrics ──────────────────────────────────────────────────────

export async function fetchSystemMetrics(nodeId) {
  const cmd = `
    echo "=CPU_USAGE="
    top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1
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
    echo "=CPU_FREQ="
    cat /proc/cpuinfo | grep "MHz" | awk '{sum += $4; count++} END {printf "%.0f", sum/count}'
    echo "=HOSTNAME="
    hostname -f
  `.replace(/\n\s+/g, '\n').trim();

  try {
    const output = await execOnNode(nodeId, cmd);
    return parseSystemOutput(output);
  } catch (err) {
    console.error(`[Monitoring] System metrics failed for ${nodeId}:`, err.message);
    return { error: err.message };
  }
}

function parseSystemOutput(output) {
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

  const memUsedPct = memTotal > 0 ? Math.round(((memUsed) / memTotal) * 100) : 0;

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
    cpuFreqMhz: parseInt(sections['CPU_FREQ']?.[0] || '0'),
    hostname: sections['HOSTNAME']?.[0] || 'unknown',
    memStatus: memUsedPct >= THRESHOLDS.RAM_CRITICAL ? 'critical' :
               memUsedPct >= THRESHOLDS.RAM_WARNING ? 'warning' : 'normal'
  };
}

// ─── CPU Temperature ───────────────────────────────────────────────────────────

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

  // Try JSON first (sensors -j)
  try {
    const json = JSON.parse(output);
    for (const [chip, data] of Object.entries(json)) {
      for (const [key, vals] of Object.entries(data)) {
        if (typeof vals === 'object') {
          for (const [subkey, val] of Object.entries(vals)) {
            if (subkey.endsWith('_input')) {
              const temp = parseFloat(val);
              if (!isNaN(temp)) {
                if (key.toLowerCase().includes('core') || key.toLowerCase().includes('cpu')) {
                  cores.push({ label: key, tempC: temp });
                }
                if (key.toLowerCase().includes('package') || key.toLowerCase().includes('tdie')) {
                  packageTemp = temp;
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // Fallback: parse text output
    for (const line of output.split('\n')) {
      const match = line.match(/(.+?):\s+\+?(\d+\.\d+)°C/);
      if (match) {
        const temp = parseFloat(match[2]);
        const label = match[1].trim();
        if (label.toLowerCase().includes('core')) {
          cores.push({ label, tempC: temp });
        } else if (label.toLowerCase().includes('package')) {
          packageTemp = temp;
        }
      }
    }
  }

  const maxTemp = cores.length ? Math.max(...cores.map(c => c.tempC)) : null;
  return {
    cores,
    packageTemp,
    maxCoreTemp: maxTemp,
    thermalStatus: maxTemp
      ? (maxTemp >= THRESHOLDS.CPU_TEMP_CRITICAL ? 'critical' :
         maxTemp >= THRESHOLDS.CPU_TEMP_WARNING ? 'warning' : 'normal')
      : 'unknown'
  };
}

// ─── Disk / Storage ────────────────────────────────────────────────────────────

export async function fetchStorageMetrics(nodeId) {
  const cmd = `
    echo "=DF="
    df -BGB --output=source,fstype,size,used,avail,pcent,target 2>/dev/null | tail -n+2
    echo "=NVME="
    lsblk -d -o NAME,TYPE,ROTA,SIZE,MODEL 2>/dev/null | grep -i nvme
    echo "=IO="
    iostat -x 1 1 2>/dev/null | awk '/^[a-z]/{print $1,$4,$5,$16}' | head -20
  `.replace(/\n\s+/g, '\n').trim();

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
    if (line.startsWith('=') && line.endsWith('=')) {
      current = line.slice(1, -1);
      sections[current] = [];
    } else if (current && line.trim()) {
      sections[current].push(line.trim());
    }
  }

  const filesystems = (sections['DF'] || [])
    .filter(line => !line.startsWith('tmpfs') && !line.startsWith('udev'))
    .map(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 7) return null;
      const usedPct = parseInt(parts[5]);
      return {
        source: parts[0],
        fstype: parts[1],
        sizeGB: parseInt(parts[2]),
        usedGB: parseInt(parts[3]),
        availGB: parseInt(parts[4]),
        usedPct: isNaN(usedPct) ? 0 : usedPct,
        mountpoint: parts[6],
        isNVMe: parts[0].includes('nvme'),
        isSSD: !parts[0].includes('sd') || parts[1] === 'ext4',
        status: usedPct >= 90 ? 'critical' : usedPct >= 75 ? 'warning' : 'normal'
      };
    })
    .filter(Boolean)
    .filter(fs => ['/home', '/data', '/storage', '/mnt', '/'].some(m => fs.mountpoint.startsWith(m)));

  const nvmeDevices = (sections['NVME'] || []).map(line => {
    const parts = line.split(/\s+/);
    return { name: parts[0], size: parts[3], model: parts.slice(4).join(' ') };
  });

  return { filesystems, nvmeDevices };
}

// ─── Per-User Resource Usage ───────────────────────────────────────────────────

export async function fetchUserResourceUsage(nodeId) {
  const cmd = `
    echo "=PROCS="
    ps aux --no-headers | awk '{print $1,$2,$3,$4,$11}' | head -200
    echo "=USERS="
    who | awk '{print $1}' | sort -u
  `.replace(/\n\s+/g, '\n').trim();

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
    if (line.startsWith('=') && line.endsWith('=')) {
      current = line.slice(1, -1);
      sections[current] = [];
    } else if (current && line.trim()) {
      sections[current].push(line.trim());
    }
  }

  const userStats = {};
  const systemUsers = new Set(['root', 'daemon', 'sys', 'sync', 'games', 'man', 'lp',
    'mail', 'news', 'uucp', 'proxy', 'www-data', 'nobody', 'systemd-network',
    'systemd-resolve', 'messagebus', 'syslog', '_apt', 'ntp', 'postfix', 'monitor']);

  for (const line of (sections['PROCS'] || [])) {
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const [user, pid, cpu, mem] = parts;
    if (systemUsers.has(user) || user.startsWith('_')) continue;

    if (!userStats[user]) {
      userStats[user] = { user, cpuPct: 0, memPct: 0, processCount: 0, pids: [] };
    }
    userStats[user].cpuPct += parseFloat(cpu) || 0;
    userStats[user].memPct += parseFloat(mem) || 0;
    userStats[user].processCount++;
    userStats[user].pids.push(parseInt(pid));
  }

  return {
    users: Object.values(userStats)
      .sort((a, b) => b.cpuPct - a.cpuPct)
      .map(u => ({ ...u, cpuPct: Math.round(u.cpuPct * 10) / 10, memPct: Math.round(u.memPct * 10) / 10 }))
  };
}

// ─── Process List ──────────────────────────────────────────────────────────────

export async function fetchHeavyProcesses(nodeId) {
  const cmd = `ps aux --no-headers --sort=-%cpu | awk '$3 > 0.5 || $4 > 0.5 {print $1,$2,$3,$4,$8,$9,$11}' | head -60`;

  try {
    const output = await execOnNode(nodeId, cmd);
    const processes = output.split('\n').filter(Boolean).map(line => {
      const parts = line.split(/\s+/);
      const [user, pid, cpu, mem, stat, start, ...cmdParts] = parts;
      const cmdStr = cmdParts.join(' ');
      const isHeavy = ['python', 'python3', 'docker', 'ffmpeg', 'jupyter', 'nvcc', 'torchrun', 'deepspeed'].some(
        p => cmdStr.toLowerCase().includes(p)
      );
      return {
        user, pid: parseInt(pid), cpuPct: parseFloat(cpu),
        memPct: parseFloat(mem), stat, start, cmd: cmdStr,
        isHeavy, vramMiB: 0, gpuUtilPct: 0, isZombie: false, nodeId
      };
    }).filter(p => !isNaN(p.pid));

    return processes;
  } catch (err) {
    console.error(`[Monitoring] Process fetch failed for ${nodeId}:`, err.message);
    return [];
  }
}

// ─── Zombie Detection ──────────────────────────────────────────────────────────

/**
 * Mark processes as zombies if they hold VRAM but have 0% GPU utilization
 * for ZOMBIE_CONSECUTIVE_POLLS consecutive monitoring cycles.
 */
export function detectZombieProcesses(processes, processVram) {
  // Merge VRAM data into processes
  const vramMap = new Map(processVram.map(p => [p.pid, p]));

  return processes.map(proc => {
    const vramData = vramMap.get(proc.pid);
    if (vramData) {
      proc.vramMiB = vramData.vramUsedMiB;
      proc.gpuIndex = vramData.gpuIndex;
    }

    // Track zero-util history
    const key = `${proc.nodeId}-${proc.pid}`;
    if (proc.vramMiB > 0 && proc.gpuUtilPct === 0) {
      const count = (gpuUtilHistory.get(key) || 0) + 1;
      gpuUtilHistory.set(key, count);
      proc.zombieScore = count;
      proc.isZombie = count >= THRESHOLDS.ZOMBIE_CONSECUTIVE_POLLS;
      proc.zombieMinutes = Math.round((count * 5) / 60 * 10) / 10; // ~5s per poll
    } else {
      gpuUtilHistory.delete(key);
      proc.zombieScore = 0;
      proc.isZombie = false;
    }

    return proc;
  });
}

// Clean up stale zombie history entries for processes that no longer exist
export function cleanupZombieHistory(activeProcesses) {
  const activePids = new Set(activeProcesses.map(p => `${p.nodeId}-${p.pid}`));
  for (const key of gpuUtilHistory.keys()) {
    if (!activePids.has(key)) {
      gpuUtilHistory.delete(key);
    }
  }
}

// ─── Aggregate Full Node Snapshot ─────────────────────────────────────────────

export async function fetchFullNodeSnapshot(nodeId) {
  const [gpu, system, cpuTemps, storage, userUsage, processes] = await Promise.allSettled([
    fetchGPUMetrics(nodeId),
    fetchSystemMetrics(nodeId),
    fetchCPUTemps(nodeId),
    fetchStorageMetrics(nodeId),
    fetchUserResourceUsage(nodeId),
    fetchHeavyProcesses(nodeId)
  ]);

  const gpuData = gpu.status === 'fulfilled' ? gpu.value : { gpus: [], processVram: [], error: gpu.reason?.message };
  const procData = processes.status === 'fulfilled' ? processes.value : [];

  // Merge VRAM + zombie detection into process list
  const enrichedProcs = detectZombieProcesses(procData, gpuData.processVram || []);
  cleanupZombieHistory(enrichedProcs);

  // Merge VRAM per-user totals
  const userVramMap = {};
  for (const p of enrichedProcs) {
    if (p.vramMiB > 0 && p.user) {
      userVramMap[p.user] = (userVramMap[p.user] || 0) + p.vramMiB;
    }
  }

  const userData = userUsage.status === 'fulfilled' ? userUsage.value : { users: [] };
  const usersWithVram = userData.users.map(u => ({
    ...u,
    vramMiB: userVramMap[u.user] || 0
  }));

  // Generate alerts
  const alerts = generateAlerts(nodeId, gpuData.gpus, system.status === 'fulfilled' ? system.value : {});

  return {
    nodeId,
    nodeLabel: NODES[nodeId]?.label,
    timestamp: new Date().toISOString(),
    gpu: gpuData,
    system: system.status === 'fulfilled' ? system.value : { error: system.reason?.message },
    cpuTemps: cpuTemps.status === 'fulfilled' ? cpuTemps.value : { error: cpuTemps.reason?.message },
    storage: storage.status === 'fulfilled' ? storage.value : { error: storage.reason?.message },
    users: usersWithVram,
    processes: enrichedProcs.sort((a, b) => (b.vramMiB - a.vramMiB) || (b.cpuPct - a.cpuPct)),
    alerts
  };
}

function generateAlerts(nodeId, gpus, system) {
  const alerts = [];
  const isMissionCritical = NODES[nodeId]?.specs?.gpuThermalCritical;

  for (const gpu of gpus) {
    if (gpu.isCritical) {
      alerts.push({
        id: `gpu-temp-critical-${nodeId}-${gpu.index}`,
        type: 'critical',
        nodeId,
        category: 'thermal',
        message: `GPU ${gpu.index} (${gpu.name}) CRITICAL: ${gpu.tempC}°C — ${isMissionCritical ? '⚠️ POST-REPAIR MONITORING ACTIVE' : 'Thermal throttling likely'}`,
        value: gpu.tempC,
        threshold: THRESHOLDS.GPU_TEMP_CRITICAL,
        missionCritical: isMissionCritical,
        timestamp: new Date().toISOString()
      });
    } else if (gpu.thermalStatus === 'warning') {
      alerts.push({
        id: `gpu-temp-warn-${nodeId}-${gpu.index}`,
        type: 'warning',
        nodeId,
        category: 'thermal',
        message: `GPU ${gpu.index} (${gpu.name}) Warning: ${gpu.tempC}°C`,
        value: gpu.tempC,
        threshold: THRESHOLDS.GPU_TEMP_WARNING,
        missionCritical: isMissionCritical,
        timestamp: new Date().toISOString()
      });
    }
  }

  if (system.memStatus === 'critical') {
    alerts.push({
      id: `mem-critical-${nodeId}`,
      type: 'critical',
      nodeId,
      category: 'memory',
      message: `RAM usage critical: ${system.memUsedPct}% (${system.memUsedMiB}MB / ${system.memTotalMiB}MB)`,
      value: system.memUsedPct,
      threshold: THRESHOLDS.RAM_CRITICAL,
      timestamp: new Date().toISOString()
    });
  }

  return alerts;
}
