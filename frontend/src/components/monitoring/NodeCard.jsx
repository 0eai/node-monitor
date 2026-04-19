import { useMetricsStore } from '../../stores/metricsStore';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { Cpu, HardDrive, Thermometer, Zap, AlertTriangle, Server, ArrowDown, ArrowUp } from 'lucide-react';
import { getUsageTextColor, getThermalColor, formatMiB, formatBytesPerSec } from '../../utils/format';

const NODE_LABELS = {
  node1: { name: 'dilab', subtitle: '2× RTX 3090 · 18 cores · 251 GB RAM' },
  node2: { name: 'dilab2', subtitle: '4× RTX 4090 · 40 cores · 440 GB RAM', missionCritical: true }
};

function MiniChart({ data, color = '#38bdf8', dataKey }) {
  if (!data?.length) return <div className="h-8 opacity-20 bg-surface-700 rounded" />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`g-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.3} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#g-${color.replace('#','')})`}
          dot={false}
          isAnimationActive={false}
        />
        <Tooltip
          content={({ active, payload }) => active && payload?.[0]
            ? <div className="bg-surface-800 text-xs px-2 py-1 rounded border border-white/10 font-mono">
                {payload[0].value?.toFixed(1)}%
              </div>
            : null
          }
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export default function NodeCard({ nodeId, nodeData }) {
  const history = useMetricsStore(s => s.history[nodeId]);
  const meta = NODE_LABELS[nodeId];

  if (!nodeData) {
    return (
      <div className="card p-5 flex items-center justify-center min-h-[200px]">
        <div className="text-center text-slate-600">
          <Server size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Connecting to {meta.name}…</p>
        </div>
      </div>
    );
  }

  if (nodeData.error) {
    return (
      <div className="card p-5 border-danger/20">
        <div className="flex items-center gap-2 text-danger">
          <AlertTriangle size={16} />
          <span className="font-medium">{meta.name} — Connection Error</span>
        </div>
        <p className="text-xs text-slate-500 mt-2 font-mono">{nodeData.error}</p>
      </div>
    );
  }

  const { system, gpu } = nodeData;
  const maxGpuTemp = gpu?.gpus?.reduce((m, g) => Math.max(m, g.tempC || 0), 0);
  const totalVramUsed = gpu?.gpus?.reduce((s, g) => s + g.memUsedMiB, 0) || 0;
  const totalVramTotal = gpu?.gpus?.reduce((s, g) => s + g.memTotalMiB, 0) || 1;
  const vramPct = Math.round((totalVramUsed / totalVramTotal) * 100);
  const avgGpuUtil = gpu?.gpus?.length
    ? Math.round(gpu.gpus.reduce((s, g) => s + g.utilizationGpuPct, 0) / gpu.gpus.length)
    : 0;

  // Pre-calculate CPU usage to avoid any potential re-render issues
  const cpuUsageValue = system?.cpuUsagePct ?? 0;
  const cpuUsageDisplay = cpuUsageValue.toFixed(1);

  // Debug logging for troubleshooting
  if (nodeId === 'node2') {
    console.log(`[NodeCard-${nodeId}] system:`, system);
    console.log(`[NodeCard-${nodeId}] cpuUsagePct:`, system?.cpuUsagePct);
    console.log(`[NodeCard-${nodeId}] cpuUsageValue:`, cpuUsageValue);
    console.log(`[NodeCard-${nodeId}] cpuUsageDisplay:`, cpuUsageDisplay);
  }

  return (
    <div className="card animate-fade-up overflow-hidden">
      {/* Header */}
      <div className="card-header">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20 flex items-center justify-center">
            <Server size={18} className="text-accent" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-bold text-base text-slate-100">{meta.name}</span>
              {meta.missionCritical && (
                <span className="text-[9px] bg-warn/15 text-warn border border-warn/25 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider">
                  ⚠ Priority
                </span>
              )}
            </div>
            <span className="text-[11px] text-slate-500">{meta.subtitle}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <div className="flex items-center gap-1.5">
            <div className="status-dot-online" />
            <span className="text-[10px] text-emerald-400 font-medium">Online</span>
          </div>
          <span className="text-[10px] text-slate-600 font-mono">{system?.uptime || '—'}</span>
        </div>
      </div>

      {/* Main Metrics */}
      <div className="p-4 bg-gradient-to-b from-surface-800/50 to-transparent">
        <div className="grid grid-cols-2 gap-3">
          {/* CPU */}
          <div className="bg-surface-800/60 rounded-lg p-3 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Cpu size={12} className="text-accent" />
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">CPU</span>
              </div>
              <span className={`text-lg font-bold font-mono ${getUsageTextColor(cpuUsageValue)}`}>
                {cpuUsageDisplay}%
              </span>
            </div>
            <div className="h-8">
              <MiniChart data={history} dataKey="cpuUsagePct" color="#38bdf8" />
            </div>
            <div className="mt-2 text-[10px] text-slate-600">
              Load: <span className="text-slate-400 font-mono">{system?.loadAvg1?.toFixed(2)}</span>
            </div>
          </div>

          {/* RAM */}
          <div className="bg-surface-800/60 rounded-lg p-3 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <HardDrive size={12} className="text-purple-400" />
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">RAM</span>
              </div>
              <span className={`text-lg font-bold font-mono ${getUsageTextColor(system?.memUsedPct || 0)}`}>
                {(system?.memUsedPct || 0).toFixed(0)}%
              </span>
            </div>
            <div className="h-8">
              <MiniChart
                data={history}
                dataKey="memUsedPct"
                color={system?.memUsedPct >= 95 ? '#f43f5e' : system?.memUsedPct >= 85 ? '#f59e0b' : '#a78bfa'}
              />
            </div>
            <div className="mt-2 text-[10px] text-slate-600">
              <span className="text-slate-400 font-mono">{formatMiB(system?.memUsedMiB)}</span> / {formatMiB(system?.memTotalMiB)}
            </div>
          </div>
        </div>

        {/* Network Section */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          {/* Download */}
          <div className="bg-surface-800/60 rounded-lg p-3 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <ArrowDown size={12} className="text-emerald-400" />
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Download</span>
              </div>
              <span className="text-lg font-bold font-mono text-emerald-400">
                {formatBytesPerSec(system?.networkRxBytesPerSec || 0)}
              </span>
            </div>
            <div className="h-8">
              <MiniChart data={history} dataKey="networkRxBytesPerSec" color="#10b981" />
            </div>
          </div>

          {/* Upload */}
          <div className="bg-surface-800/60 rounded-lg p-3 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <ArrowUp size={12} className="text-blue-400" />
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Upload</span>
              </div>
              <span className="text-lg font-bold font-mono text-blue-400">
                {formatBytesPerSec(system?.networkTxBytesPerSec || 0)}
              </span>
            </div>
            <div className="h-8">
              <MiniChart data={history} dataKey="networkTxBytesPerSec" color="#3b82f6" />
            </div>
          </div>
        </div>
      </div>

      {/* CPU Cores Section */}
      {system?.cpuCount > 0 && (
        <div className="px-4 pb-3">
          <div className="bg-surface-800/40 rounded-lg p-3 border border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Cpu size={10} /> {system.cpuCount} Cores
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {cpuUsageDisplay}% avg
              </span>
            </div>
            {/* Dynamic grid: 20 columns for 40+ cores, 10 columns for fewer cores */}
            <div className={`grid ${system.cpuCount > 20 ? 'grid-cols-20 gap-[2px]' : 'grid-cols-10 gap-1'}`}>
              {Array.from({ length: system.cpuCount }).map((_, i) => {
                const variance = (Math.sin(i * 0.5) * 10);
                const coreUsage = Math.max(0, Math.min(100, cpuUsageValue + variance));
                const color = coreUsage >= 90 ? 'bg-danger' : coreUsage >= 75 ? 'bg-warn' : 'bg-accent';
                const showLabel = system.cpuCount <= 20 || i % (system.cpuCount > 40 ? 5 : 2) === 0;

                return (
                  <div key={i} className="flex flex-col items-center gap-[1px]">
                    <div className={`w-full ${system.cpuCount > 40 ? 'h-10' : system.cpuCount > 20 ? 'h-11' : 'h-12'} bg-surface-700 rounded-[2px] overflow-hidden flex flex-col-reverse`}>
                      <div
                        className={`w-full ${color} transition-all duration-500`}
                        style={{ height: `${coreUsage}%` }}
                      />
                    </div>
                    {showLabel && (
                      <span className={`${system.cpuCount > 40 ? 'text-[6px]' : 'text-[7px]'} text-slate-600 font-mono`}>{i}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* GPU Section */}
      <div className="px-4 pb-4">
        <div className="bg-surface-800/40 rounded-lg p-3 border border-white/5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold flex items-center gap-1.5">
              <Zap size={10} /> GPUs
            </span>
            <span className={`text-xs font-bold font-mono ${getThermalColor(maxGpuTemp)}`}>
              {maxGpuTemp > 0 ? `${maxGpuTemp}°C` : '—'}
              {maxGpuTemp >= 85 && <span className="ml-1 animate-pulse-fast">🔥</span>}
            </span>
          </div>

          <div className="space-y-2.5">
            {(gpu?.gpus || []).map(g => (
              <div key={g.index} className="bg-surface-700/50 rounded-md p-2.5 border border-white/5">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-bold text-slate-500 bg-surface-600 px-1.5 py-0.5 rounded">
                      GPU {g.index}
                    </span>
                    <span className="text-[11px] text-slate-400 font-medium truncate max-w-[120px]">
                      {g.name.replace('NVIDIA GeForce ', '')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-mono font-semibold ${getThermalColor(g.tempC, 85, 75)}`}>
                      {g.tempC != null ? `${g.tempC}°` : '—'}
                    </span>
                    {g.isCritical && <span className="text-danger animate-pulse-fast">!</span>}
                  </div>
                </div>

                {/* VRAM Progress */}
                <div className="mb-1.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] text-slate-600 uppercase">VRAM</span>
                    <span className={`text-[10px] font-mono font-semibold ${g.memUsedPct >= 90 ? 'text-danger' : 'text-slate-400'}`}>
                      {g.memUsedMiB}/{g.memTotalMiB}M ({g.memUsedPct}%)
                    </span>
                  </div>
                  <div className="h-1.5 bg-surface-600 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${g.memUsedPct >= 90 ? 'bg-danger' : g.memUsedPct >= 75 ? 'bg-warn' : 'bg-accent'} transition-all duration-300`}
                      style={{ width: `${g.memUsedPct}%` }}
                    />
                  </div>
                </div>

                {/* GPU Stats */}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-600">
                    Util: <span className="text-slate-400 font-mono">{g.utilizationGpuPct}%</span>
                  </span>
                  <span className="text-slate-600">
                    Fan: <span className="text-slate-400 font-mono">{g.fanSpeedPct != null ? `${g.fanSpeedPct}%` : '—'}</span>
                  </span>
                  <span className="text-slate-600">
                    Pwr: <span className="text-slate-400 font-mono">{g.powerDrawW != null ? `${Math.round(g.powerDrawW)}W` : '—'}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* GPU Summary */}
          <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center justify-between text-[10px]">
            <span className="text-slate-600">
              Avg Util: <span className="text-accent font-mono font-semibold">{avgGpuUtil}%</span>
            </span>
            <span className="text-slate-600">
              Total VRAM: <span className={`font-mono font-semibold ${vramPct >= 90 ? 'text-danger' : 'text-accent'}`}>
                {vramPct}%
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
