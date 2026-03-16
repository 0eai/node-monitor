import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useAuthStore } from '../stores/authStore';
import { formatMiB, truncateCmd, relativeTime } from '../utils/format';
import { Cpu, Skull, Zap, AlertTriangle, Filter, Search, X, XCircle, Target } from 'lucide-react';

function KillButton({ process, onKill }) {
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState('graceful'); // graceful | force

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={() => { onKill(process, mode === 'force'); setConfirming(false); }}
          className="text-[11px] px-2 py-1 rounded bg-danger/20 text-danger border border-danger/30 hover:bg-danger/35 font-medium"
        >
          {mode === 'force' ? 'Force Kill' : 'Confirm Kill'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-[11px] p-1 rounded text-slate-500 hover:text-slate-300"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={() => { setMode('graceful'); setConfirming(true); }}
        className="text-[11px] px-2 py-1 rounded bg-warn/10 text-warn border border-warn/20 hover:bg-warn/20"
        title="Graceful kill (SIGTERM)"
      >
        <XCircle size={11} />
      </button>
      <button
        onClick={() => { setMode('force'); setConfirming(true); }}
        className="text-[11px] px-2 py-1 rounded bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20"
        title="Force kill (SIGKILL)"
      >
        <Skull size={11} />
      </button>
    </div>
  );
}

function ProcessRow({ proc, canKill, onKill }) {
  const isZombie = proc.isZombie;
  const hasVram = proc.vramMiB > 0;

  return (
    <tr className={`group hover:bg-white/2 transition-colors border-b border-white/3
      ${isZombie ? 'bg-danger/5 border-l-2 border-l-danger/50' : ''}`}
    >
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          {isZombie && (
            <span title={`Zombie: ${proc.zombieMinutes}min idle with ${formatMiB(proc.vramMiB)} VRAM locked`}>
              <Skull size={13} className="text-danger animate-pulse flex-shrink-0" />
            </span>
          )}
          <span className="font-mono text-xs text-slate-400">{proc.pid}</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded bg-surface-600 flex items-center justify-center flex-shrink-0">
            <span className="text-[9px] font-bold text-slate-400">{proc.user?.[0]?.toUpperCase()}</span>
          </div>
          <span className="text-xs font-mono text-slate-300">{proc.user}</span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <div>
          <span className="text-xs text-slate-300 font-mono">{truncateCmd(proc.cmd, 45)}</span>
          <div className="text-[10px] text-slate-600 mt-0.5 font-mono">
            {proc.nodeId === 'node1' ? 'dilab' : 'dilab2'} · PID {proc.pid}
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span className={`text-xs font-mono ${proc.cpuPct > 80 ? 'text-warn' : 'text-slate-400'}`}>
          {proc.cpuPct.toFixed(1)}%
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className="text-xs font-mono text-slate-400">{proc.memPct.toFixed(1)}%</span>
      </td>
      <td className="px-4 py-2.5">
        {hasVram ? (
          <div>
            <span className={`text-xs font-mono font-medium ${isZombie ? 'text-danger' : 'text-slate-300'}`}>
              {formatMiB(proc.vramMiB)}
            </span>
            {proc.gpuIndex !== undefined && proc.gpuIndex !== null && (
              <span className="text-[10px] text-slate-600 ml-1">G{proc.gpuIndex}</span>
            )}
            {isZombie && (
              <div className="text-[10px] text-danger/70 mt-0.5">
                Idle {proc.zombieMinutes?.toFixed(1)}min
              </div>
            )}
          </div>
        ) : (
          <span className="text-slate-700 text-xs">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className={`text-xs font-mono ${proc.gpuUtilPct > 0 ? 'text-success' : 'text-slate-600'}`}>
          {hasVram ? `${proc.gpuUtilPct}%` : '—'}
        </span>
      </td>
      <td className="px-4 py-2.5 w-24">
        {canKill && <KillButton process={proc} onKill={onKill} />}
      </td>
    </tr>
  );
}

export default function ProcessesPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | zombies | gpu | heavy
  const [nodeFilter, setNodeFilter] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['processes'],
    queryFn: () => api.get('/processes/list').then(r => r.data),
    refetchInterval: 5000
  });

  const killMutation = useMutation({
    mutationFn: ({ nodeId, pid, force }) =>
      api.post('/processes/kill', { nodeId, pid, force }),
    onSuccess: (_, vars) => {
      toast.success(`Process ${vars.pid} killed`);
      queryClient.invalidateQueries(['processes']);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Kill failed');
    }
  });

  const killZombiesMutation = useMutation({
    mutationFn: ({ nodeId, force }) =>
      api.post('/processes/kill-zombie-batch', { nodeId, force }),
    onSuccess: (data) => {
      toast.success(`Killed ${data.data.killed} zombies, freed ${formatMiB(data.data.freeingVramMiB)}`);
      queryClient.invalidateQueries(['processes']);
    }
  });

  const handleKill = (proc, force) => {
    killMutation.mutate({ nodeId: proc.nodeId, pid: proc.pid, force });
  };

  const processes = data?.processes || [];
  const zombieCount = data?.zombieCount || 0;
  const totalVram = data?.totalVramMiB || 0;

  const canKillProcess = (proc) => {
    if (user?.isAdmin) return true;
    return proc.user === user?.username;
  };

  const filtered = processes.filter(p => {
    if (nodeFilter !== 'all' && p.nodeId !== nodeFilter) return false;
    if (filter === 'zombies' && !p.isZombie) return false;
    if (filter === 'gpu' && !p.vramMiB) return false;
    if (filter === 'heavy' && !p.isHeavy) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.user?.toLowerCase().includes(q) || p.cmd?.toLowerCase().includes(q) || String(p.pid).includes(q);
    }
    return true;
  });

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <Cpu size={20} className="text-accent" />
            Processes & GPU
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {processes.length} processes · {formatMiB(totalVram)} VRAM in use
            {zombieCount > 0 && (
              <span className="ml-2 text-danger font-medium">· {zombieCount} zombie{zombieCount > 1 ? 's' : ''} detected</span>
            )}
          </p>
        </div>

        {/* Zombie batch kill */}
        {user?.isAdmin && zombieCount > 0 && (
          <div className="flex gap-2">
            {['node1', 'node2'].map(nodeId => {
              const nodeZombies = processes.filter(p => p.nodeId === nodeId && p.isZombie);
              if (!nodeZombies.length) return null;
              return (
                <button key={nodeId}
                  onClick={() => killZombiesMutation.mutate({ nodeId, force: false })}
                  disabled={killZombiesMutation.isPending}
                  className="btn-danger text-xs"
                >
                  <Skull size={12} />
                  Kill {nodeZombies.length} Zombies ({nodeId === 'node1' ? 'dilab' : 'dilab2'})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Zombie alert box */}
      {zombieCount > 0 && (
        <div className="alert-critical p-4 rounded-xl">
          <div className="flex items-start gap-3">
            <Skull size={18} className="text-danger mt-0.5 flex-shrink-0 animate-pulse" />
            <div>
              <p className="font-semibold text-danger text-sm">
                {zombieCount} zombie process{zombieCount > 1 ? 'es' : ''} detected
              </p>
              <p className="text-xs text-slate-400 mt-1">
                These processes are holding VRAM but have shown 0% GPU utilization for an extended period.
                {user?.isAdmin ? ' Use "Kill Zombies" to free GPU memory.' : ' Contact an admin or kill your own zombie processes.'}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {processes.filter(p => p.isZombie).map(p => (
                  <span key={`${p.nodeId}-${p.pid}`} className="text-[11px] font-mono bg-surface-700 px-2 py-0.5 rounded border border-danger/20 text-danger/80">
                    {p.user}:{p.pid} ({formatMiB(p.vramMiB)}, {p.zombieMinutes?.toFixed(0)}min idle)
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1 min-w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search user, command, PID…"
              className="w-full bg-surface-900 border border-white/8 rounded-lg pl-8 pr-3 py-2 text-sm text-slate-300
                         placeholder:text-slate-600 focus:outline-none focus:border-accent/50 font-mono text-xs"
            />
          </div>

          {/* Type filter */}
          <div className="flex rounded-lg overflow-hidden border border-white/8">
            {[
              { id: 'all', label: 'All' },
              { id: 'gpu', label: 'GPU', icon: Zap },
              { id: 'zombies', label: `Zombies${zombieCount > 0 ? ` (${zombieCount})` : ''}`, icon: Skull },
              { id: 'heavy', label: 'Heavy', icon: Target }
            ].map(f => (
              <button key={f.id} onClick={() => setFilter(f.id)}
                className={`px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors
                  ${filter === f.id
                    ? f.id === 'zombies' ? 'bg-danger/20 text-danger' : 'bg-accent/15 text-accent'
                    : 'text-slate-500 hover:text-slate-300'
                  }`}
              >
                {f.icon && <f.icon size={11} />}
                {f.label}
              </button>
            ))}
          </div>

          {/* Node filter */}
          <div className="flex rounded-lg overflow-hidden border border-white/8">
            {[
              { id: 'all', label: 'Both' },
              { id: 'node1', label: 'dilab' },
              { id: 'node2', label: 'dilab2' }
            ].map(n => (
              <button key={n.id} onClick={() => setNodeFilter(n.id)}
                className={`px-3 py-1.5 text-xs transition-colors
                  ${nodeFilter === n.id ? 'bg-white/8 text-slate-200' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {n.label}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-600 ml-auto">{filtered.length} shown</span>
        </div>
      </div>

      {/* Process Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-slate-600">
            <div className="w-6 h-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin mx-auto mb-2" />
            Loading processes…
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5 bg-surface-700/30">
                  {['PID', 'User', 'Command', 'CPU', 'RAM', 'VRAM', 'GPU Util', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filtered.map(proc => (
                    <ProcessRow
                      key={`${proc.nodeId}-${proc.pid}`}
                      proc={proc}
                      canKill={canKillProcess(proc)}
                      onKill={handleKill}
                    />
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="p-8 text-center text-slate-600 text-sm">
                No processes match the current filter.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
