import { HardDrive, Database } from 'lucide-react';
import { getUsageColor, getUsageTextColor } from '../../utils/format';

export default function StoragePanel({ nodeId, storage }) {
  const nodeName = nodeId === 'node1' ? 'dilab' : 'dilab2';
  if (!storage?.filesystems?.length) return null;

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <HardDrive size={15} className="text-slate-400" />
          <span className="font-medium text-sm text-slate-200">Storage — {nodeName}</span>
        </div>
        <span className="text-xs text-slate-500">
          {storage.filesystems.length} mount{storage.filesystems.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="p-4 space-y-2.5">
        {storage.filesystems.map((fs, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`${fs.isNVMe ? 'text-accent' : 'text-slate-500'} font-mono text-[11px] truncate`}>
                  {fs.mountpoint}
                </span>
                {fs.isNVMe && (
                  <span className="text-[9px] bg-accent/10 text-accent px-1 rounded font-medium">NVMe</span>
                )}
              </div>
              <div className="flex items-center gap-2 font-mono flex-shrink-0">
                <span className={getUsageTextColor(fs.usedPct)}>{fs.usedPct}%</span>
                <span className="text-slate-600">{fs.usedGB}/{fs.sizeGB}GB</span>
              </div>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill ${getUsageColor(fs.usedPct)}`}
                style={{ width: `${Math.min(fs.usedPct, 100)}%` }}
              />
            </div>
          </div>
        ))}
        {storage.nvmeDevices?.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <p className="text-[11px] text-slate-600 mb-1">NVMe devices: {storage.nvmeDevices.map(d => d.name).join(', ')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
