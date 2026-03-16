import { useMetricsStore } from '../../stores/metricsStore';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';
import { Cpu, HardDrive, Thermometer, Zap, AlertTriangle, Server } from 'lucide-react';
import { getUsageColor, getUsageTextColor, getThermalColor, formatMiB } from '../../utils/format';

const NODE_LABELS = {
  node1: { name: 'dilab', subtitle: '2× RTX 3090 · 18 cores · 251 GB RAM' },
  node2: { name: 'dilab2', subtitle: '4× RTX 4090 · 40 cores · 440 GB RAM', missionCritical: true }
};

function MiniChart({ data, color = '#38bdf8', dataKey }) {
  if (!data?.length) return <div className="h-10 opacity-20 bg-surface-700 rounded" />;
  return (
    <ResponsiveContainer width="100%" height={40}>
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

function StatBlock({ label, value, pct, chart, color, icon: Icon, unit = '%' }) {
  const barColor = getUsageColor(pct);
  const textColor = getUsageTextColor(pct);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          {Icon && <Icon size={11} />}
          <span className="uppercase tracking-wider">{label}</span>
        </div>
        <span className={`text-sm font-semibold font-mono tabular-nums ${textColor}`}>
          {value ?? `${pct}${unit}`}
        </span>
      </div>
      <div className="progress-bar">
        <div className={`progress-fill ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {chart && (
        <div className="mt-1">
          <MiniChart data={chart.data} dataKey={chart.key} color={color} />
        </div>
      )}
    </div>
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

  return (
    <div className="card animate-fade-up">
      {/* Header */}
      <div className="card-header">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-surface-700 border border-white/8 flex items-center justify-center">
            <Server size={15} className="text-slate-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display font-semibold text-slate-100">{meta.name}</span>
              {meta.missionCritical && (
                <span className="text-[10px] bg-warn/15 text-warn border border-warn/25 px-1.5 py-0.5 rounded font-medium uppercase tracking-wider">
                  ⚠ Thermal Priority
                </span>
              )}
            </div>
            <span className="text-xs text-slate-500">{meta.subtitle}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="status-dot-online" />
          <span className="text-xs text-slate-500 font-mono">{system?.uptime || '—'}</span>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {/* CPU */}
          <StatBlock
            label="CPU"
            icon={Cpu}
            pct={system?.cpuUsagePct || 0}
            value={`${(system?.cpuUsagePct || 0).toFixed(1)}%`}
            chart={{ data: history, key: 'cpuUsagePct' }}
            color="#38bdf8"
          />

          {/* RAM */}
          <StatBlock
            label="RAM"
            icon={HardDrive}
            pct={system?.memUsedPct || 0}
            value={`${formatMiB(system?.memUsedMiB)} / ${formatMiB(system?.memTotalMiB)}`}
            chart={{ data: history, key: 'memUsedPct' }}
            color={system?.memUsedPct >= 95 ? '#f43f5e' : system?.memUsedPct >= 85 ? '#f59e0b' : '#38bdf8'}
          />
        </div>

        {/* GPU row */}
        <div className="pt-3 border-t border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Zap size={11} /> GPU Compute
            </span>
            <span className={`text-sm font-semibold font-mono ${getThermalColor(maxGpuTemp)}`}>
              {maxGpuTemp > 0 ? `${maxGpuTemp}°C peak` : '—'}
              {maxGpuTemp >= 85 && <span className="ml-1 animate-pulse-fast">🔥</span>}
            </span>
          </div>

          {/* Individual GPUs */}
          <div className="space-y-2">
            {(gpu?.gpus || []).map(g => (
              <div key={g.index} className="flex items-center gap-3">
                <span className="text-[11px] text-slate-600 font-mono w-5">G{g.index}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-500 truncate">{g.name}</span>
                    <div className="flex items-center gap-2 text-[11px] font-mono">
                      <span className={getThermalColor(g.tempC, 85, 75)}>
                        {g.tempC != null ? `${g.tempC}°C` : '—'}
                        {g.isCritical && <span className="ml-0.5 animate-flicker">!</span>}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{g.utilizationGpuPct}%</span>
                      <span className="text-slate-600">·</span>
                      <span className={g.memUsedPct >= 90 ? 'text-danger' : 'text-slate-400'}>
                        {g.memUsedMiB}/{g.memTotalMiB}M
                      </span>
                    </div>
                  </div>
                  {/* VRAM bar */}
                  <div className="progress-bar">
                    <div
                      className={`progress-fill ${g.memUsedPct >= 90 ? 'bg-danger' : g.memUsedPct >= 75 ? 'bg-warn' : 'bg-accent'}`}
                      style={{ width: `${g.memUsedPct}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Aggregated GPU stats */}
          <div className="flex items-center gap-4 pt-1">
            <div className="text-xs text-slate-500">
              Avg util: <span className="text-slate-300 font-mono">{avgGpuUtil}%</span>
            </div>
            <div className="text-xs text-slate-500">
              VRAM: <span className={`font-mono ${vramPct >= 90 ? 'text-danger' : 'text-slate-300'}`}>
                {totalVramUsed}/{totalVramTotal} MiB ({vramPct}%)
              </span>
            </div>
            <div className="text-xs text-slate-500">
              Load: <span className="text-slate-300 font-mono">{system?.loadAvg1?.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
