import { Users, Cpu, HardDrive, Zap } from 'lucide-react';
import { formatMiBShort, getUsageTextColor } from '../../utils/format';

function mergeUsers(node1Users = [], node2Users = [], node1Gpu, node2Gpu) {
  const map = {};

  const totalNode1Vram = node1Gpu?.gpus?.reduce((s, g) => s + g.memTotalMiB, 0) || 1;
  const totalNode2Vram = node2Gpu?.gpus?.reduce((s, g) => s + g.memTotalMiB, 0) || 1;

  const addNode = (users, nodeId, totalVram) => {
    for (const u of users) {
      if (!map[u.user]) map[u.user] = {
        user: u.user,
        node1: null, node2: null,
        totalCpu: 0, totalMem: 0, totalVram: 0
      };
      map[u.user][nodeId] = { ...u, nodeVramTotal: totalVram };
      map[u.user].totalCpu += u.cpuPct || 0;
      map[u.user].totalMem += u.memPct || 0;
      map[u.user].totalVram += u.vramMiB || 0;
    }
  };

  addNode(node1Users, 'node1', totalNode1Vram);
  addNode(node2Users, 'node2', totalNode2Vram);

  return Object.values(map).sort((a, b) => b.totalVram - a.totalVram || b.totalCpu - a.totalCpu);
}

function UsageBar({ value, max = 100, colorClass }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 progress-bar h-1">
        <div className={`progress-fill ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-slate-400 w-8 text-right tabular-nums">
        {value.toFixed(1)}%
      </span>
    </div>
  );
}

export default function UserResourceTable({ node1Users, node2Users, node1GpuData, node2GpuData }) {
  const merged = mergeUsers(node1Users, node2Users, node1GpuData, node2GpuData);

  if (!merged.length) return null;

  return (
    <div className="card">
      <div className="card-header">
        <div className="flex items-center gap-2">
          <Users size={15} className="text-slate-400" />
          <span className="font-medium text-sm text-slate-200">Per-User Resource Usage</span>
        </div>
        <span className="text-xs text-slate-500">{merged.length} active user{merged.length > 1 ? 's' : ''}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              {['User', 'Node 1 — CPU', 'Node 1 — RAM', 'Node 2 — CPU', 'Node 2 — RAM', 'VRAM Total', 'Procs'].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/3">
            {merged.map(u => (
              <tr key={u.user} className="hover:bg-white/2 transition-colors">
                {/* Username */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-accent/10 border border-accent/15 flex items-center justify-center flex-shrink-0">
                      <span className="text-[10px] font-semibold text-accent">{u.user[0]?.toUpperCase()}</span>
                    </div>
                    <span className="font-mono text-xs text-slate-300">{u.user}</span>
                  </div>
                </td>

                {/* Node1 CPU */}
                <td className="px-4 py-3 w-32">
                  {u.node1 ? <UsageBar value={u.node1.cpuPct} colorClass="bg-accent" /> : <span className="text-slate-700 text-xs">—</span>}
                </td>

                {/* Node1 RAM */}
                <td className="px-4 py-3 w-32">
                  {u.node1 ? <UsageBar value={u.node1.memPct} colorClass="bg-indigo-400" /> : <span className="text-slate-700 text-xs">—</span>}
                </td>

                {/* Node2 CPU */}
                <td className="px-4 py-3 w-32">
                  {u.node2 ? <UsageBar value={u.node2.cpuPct} colorClass="bg-accent" /> : <span className="text-slate-700 text-xs">—</span>}
                </td>

                {/* Node2 RAM */}
                <td className="px-4 py-3 w-32">
                  {u.node2 ? <UsageBar value={u.node2.memPct} colorClass="bg-indigo-400" /> : <span className="text-slate-700 text-xs">—</span>}
                </td>

                {/* VRAM */}
                <td className="px-4 py-3">
                  <span className={`font-mono text-xs font-medium ${u.totalVram > 0 ? getUsageTextColor(
                    Math.round((u.totalVram / ((node1GpuData?.gpus?.reduce((s,g)=>s+g.memTotalMiB,0)||1) + (node2GpuData?.gpus?.reduce((s,g)=>s+g.memTotalMiB,0)||1))) * 100)
                  ) : 'text-slate-600'}`}>
                    {u.totalVram > 0 ? formatMiBShort(u.totalVram) : '—'}
                  </span>
                </td>

                {/* Process count */}
                <td className="px-4 py-3">
                  <span className="text-xs text-slate-500 font-mono">
                    {(u.node1?.processCount || 0) + (u.node2?.processCount || 0)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
