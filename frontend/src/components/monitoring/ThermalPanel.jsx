import { Thermometer, Fan, Zap, AlertTriangle } from 'lucide-react';
import { getThermalColor, getThermalBg } from '../../utils/format';
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { useMetricsStore } from '../../stores/metricsStore';

const THRESHOLDS = { critical: 85, warning: 75 };

function TempGauge({ temp, max = 100, label, size = 'md' }) {
  const pct = Math.min((temp / max) * 100, 100);
  const angle = -135 + (pct / 100) * 270; // -135 to +135 degrees
  const color = temp >= THRESHOLDS.critical ? '#f43f5e'
    : temp >= THRESHOLDS.warning ? '#f59e0b'
    : temp >= 60 ? '#fb923c'
    : '#10b981';

  const r = size === 'sm' ? 26 : 34;
  const cx = size === 'sm' ? 30 : 40;
  const cy = size === 'sm' ? 30 : 40;
  const dim = size === 'sm' ? 60 : 80;
  const circumference = 2 * Math.PI * r;
  const trackPct = 0.75; // 270/360
  const dashArray = circumference * trackPct;
  const dashOffset = dashArray - (dashArray * pct / 100);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: dim, height: dim }}>
        <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} className="-rotate-[135deg]">
          {/* Track */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)"
            strokeWidth="4" strokeDasharray={`${dashArray} ${circumference - dashArray}`}
            strokeLinecap="round" />
          {/* Fill */}
          {temp != null && (
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={color}
              strokeWidth="4"
              strokeDasharray={`${dashArray} ${circumference - dashArray}`}
              strokeDashoffset={dashOffset}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 0 4px ${color}80)`, transition: 'stroke-dashoffset 0.5s ease' }}
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={{ color, fontSize: size === 'sm' ? 11 : 14 }} className="font-mono font-bold">
            {temp != null ? `${temp}°` : '—'}
          </span>
        </div>
      </div>
      <span className="text-[10px] text-slate-500 text-center leading-tight">{label}</span>
    </div>
  );
}

function GpuThermalRow({ gpu, history, isMissionCritical }) {
  const histData = history?.map(h => ({ t: h.gpuTemps?.[gpu.index] })) || [];
  const color = gpu.tempC >= THRESHOLDS.critical ? '#f43f5e'
    : gpu.tempC >= THRESHOLDS.warning ? '#f59e0b' : '#10b981';

  return (
    <div className={`p-3 rounded-lg border ${
      gpu.isCritical ? 'border-danger/40 bg-danger/8 shadow-glow-danger' :
      gpu.thermalStatus === 'warning' ? 'border-warn/30 bg-warn/8' :
      'border-white/5 bg-surface-700/30'
    }`}>
      <div className="flex items-start gap-3">
        <TempGauge temp={gpu.tempC} label={`G${gpu.index}`} size="sm" />

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-medium text-slate-300">{gpu.name}</span>
              {gpu.isCritical && (
                <span className="ml-2 text-[10px] text-danger animate-pulse-fast font-semibold">
                  ⚠ CRITICAL
                </span>
              )}
              {isMissionCritical && gpu.thermalStatus === 'warning' && (
                <span className="ml-2 text-[10px] text-warn font-semibold">POST-REPAIR MONITOR</span>
              )}
            </div>
            <span className={`text-xs font-mono font-semibold ${getThermalColor(gpu.tempC)}`}>
              {gpu.tempC != null ? `${gpu.tempC}°C` : '—'}
            </span>
          </div>

          {/* Mini sparkline for this GPU temp */}
          {histData.length > 1 && (
            <ResponsiveContainer width="100%" height={28}>
              <LineChart data={histData}>
                <YAxis domain={[20, 100]} hide />
                <Line type="monotone" dataKey="t" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                <Tooltip
                  content={({ active, payload }) => active && payload?.[0]
                    ? <div className="bg-surface-800 text-xs px-1.5 py-0.5 rounded font-mono">{payload[0].value}°C</div>
                    : null}
                />
              </LineChart>
            </ResponsiveContainer>
          )}

          <div className="grid grid-cols-3 gap-x-3 text-[11px] font-mono text-slate-500">
            <span>Util: <span className="text-slate-300">{gpu.utilizationGpuPct}%</span></span>
            <span>Fan: <span className="text-slate-300">{gpu.fanSpeedPct != null ? `${gpu.fanSpeedPct}%` : '—'}</span></span>
            <span>Pwr: <span className="text-slate-300">{gpu.powerDrawW != null ? `${Math.round(gpu.powerDrawW)}W` : '—'}</span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ThermalPanel({ nodeId, nodeData, isMissionCritical = false }) {
  const history = useMetricsStore(s => s.history[nodeId]);
  const nodeName = nodeId === 'node1' ? 'dilab' : 'dilab2';

  if (!nodeData || nodeData.error) return null;

  const { gpu, cpuTemps } = nodeData;
  const hasCritical = gpu?.gpus?.some(g => g.isCritical);

  return (
    <div className={`card ${hasCritical ? 'border-danger/30' : ''}`}>
      <div className="card-header">
        <div className="flex items-center gap-2">
          <Thermometer size={15} className={hasCritical ? 'text-danger animate-pulse-fast' : 'text-orange-400'} />
          <span className="font-medium text-sm text-slate-200">Thermal — {nodeName}</span>
          {isMissionCritical && (
            <span className="text-[10px] bg-warn/15 text-warn border border-warn/20 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider ml-1">
              ⚠ Post-Repair
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {cpuTemps?.maxCoreTemp && (
            <span className={`font-mono ${getThermalColor(cpuTemps.maxCoreTemp, 80, 70)}`}>
              CPU {cpuTemps.maxCoreTemp}°C
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-2.5">
        {/* GPU thermal rows */}
        {(gpu?.gpus || []).map(g => (
          <GpuThermalRow key={g.index} gpu={g} history={history} isMissionCritical={isMissionCritical} />
        ))}

        {/* CPU Temp summary */}
        {cpuTemps?.cores?.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <div className="text-xs text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1.5">
              <Zap size={10} /> CPU Cores ({cpuTemps.cores.length})
            </div>
            <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-6 2xl:grid-cols-8 gap-1.5">
              {cpuTemps.cores.map((core, i) => (
                <div key={i} className="text-center">
                  <div className={`text-xs font-mono font-semibold ${getThermalColor(core.tempC, 80, 70)}`}>
                    {core.tempC}°
                  </div>
                  <div className="text-[9px] text-slate-600 truncate">{core.label.replace('Core', 'C')}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
