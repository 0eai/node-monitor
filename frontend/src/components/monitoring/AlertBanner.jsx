import { useState } from 'react';
import { ShieldAlert, X, ChevronDown, ChevronUp, Thermometer, MemoryStick } from 'lucide-react';

const CATEGORY_ICON = {
  thermal: Thermometer,
  memory: MemoryStick
};

export default function AlertBanner({ alerts }) {
  const [expanded, setExpanded] = useState(true);
  const [dismissed, setDismissed] = useState(new Set());

  const visible = alerts.filter(a => !dismissed.has(a.id));
  const criticals = visible.filter(a => a.type === 'critical');
  const warnings = visible.filter(a => a.type === 'warning');

  if (visible.length === 0) return null;

  return (
    <div className={`rounded-xl border overflow-hidden ${criticals.length > 0 ? 'alert-critical' : 'border-warn/30 bg-warn/8'}`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`flex items-center gap-2 flex-1 ${criticals.length > 0 ? 'text-danger' : 'text-warn'}`}>
          <ShieldAlert size={16} className={criticals.length > 0 ? 'animate-pulse-fast' : ''} />
          <span className="font-semibold text-sm">
            {criticals.length > 0
              ? `${criticals.length} Critical Alert${criticals.length > 1 ? 's' : ''}`
              : `${warnings.length} Warning${warnings.length > 1 ? 's' : ''}`}
          </span>
          {criticals.length > 0 && warnings.length > 0 && (
            <span className="text-xs text-warn/80 font-normal">+ {warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>
          )}
        </div>
        {expanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
      </div>

      {/* Alert List */}
      {expanded && (
        <div className="border-t border-white/5 divide-y divide-white/5">
          {[...criticals, ...warnings].map(alert => {
            const Icon = CATEGORY_ICON[alert.category] || ShieldAlert;
            return (
              <div key={alert.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-white/3 transition-colors">
                <Icon size={14} className={`mt-0.5 flex-shrink-0 ${alert.type === 'critical' ? 'text-danger' : 'text-warn'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-200 leading-snug">{alert.message}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-slate-600 font-mono">
                      {alert.nodeId === 'node1' ? 'dilab' : 'dilab2'}
                    </span>
                    {alert.missionCritical && (
                      <span className="text-[10px] bg-warn/15 text-warn px-1.5 py-0 rounded font-medium">
                        POST-REPAIR NODE
                      </span>
                    )}
                    {alert.value !== undefined && (
                      <span className="text-[11px] text-slate-600">
                        {alert.value}{alert.category === 'thermal' ? '°C' : '%'} / threshold {alert.threshold}{alert.category === 'thermal' ? '°C' : '%'}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setDismissed(d => new Set([...d, alert.id])); }}
                  className="p-1 text-slate-600 hover:text-slate-400 rounded flex-shrink-0"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
