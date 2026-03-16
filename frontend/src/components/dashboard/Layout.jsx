import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useMetricsStore } from '../../stores/metricsStore';
import {
  Cpu, Database, Layers, LogOut, Activity,
  Wifi, WifiOff, ShieldAlert, Bell, ChevronRight
} from 'lucide-react';
import { relativeTime } from '../../utils/format';

const NAV = [
  { to: '/', label: 'Dashboard', icon: Activity, exact: true },
  { to: '/processes', label: 'Processes & GPU', icon: Cpu },
  { to: '/datasets', label: 'Dataset Hub', icon: Database },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const { wsConnected, lastUpdated, alerts, metrics } = useMetricsStore();
  const location = useLocation();

  const criticalCount = alerts.filter(a => a.type === 'critical').length;
  const warnCount = alerts.filter(a => a.type === 'warning').length;

  return (
    <div className="flex h-screen overflow-hidden bg-surface-900">

      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-white/5 bg-surface-800/60 backdrop-blur-sm">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/25 flex items-center justify-center shadow-glow-accent">
              <Layers size={16} className="text-accent" />
            </div>
            <div>
              <div className="font-display font-semibold text-sm text-slate-100">DILab</div>
              <div className="text-[10px] text-slate-500 font-mono">Monitor v1.0</div>
            </div>
          </div>
        </div>

        {/* Node Status Pills */}
        <div className="px-3 pt-3 space-y-1">
          {['node1', 'node2'].map(nodeId => {
            const node = metrics?.[nodeId];
            const label = nodeId === 'node1' ? 'dilab' : 'dilab2';
            const hasError = !node || !!node.error;
            const isMissionCritical = nodeId === 'node2';
            return (
              <div key={nodeId}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-surface-700/50 border border-white/4">
                <div className={hasError ? 'status-dot-error' : 'status-dot-online'} />
                <span className="text-xs text-slate-400 font-mono flex-1">{label}</span>
                {isMissionCritical && (
                  <span className="text-[9px] text-warn/80 font-medium uppercase tracking-wider">⚠ Thermal</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 pt-4 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 group
                 ${isActive
                  ? 'bg-accent/10 text-accent border border-accent/15'
                  : 'text-slate-500 hover:text-slate-300 hover:bg-white/4 border border-transparent'
                 }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={15} className={isActive ? 'text-accent' : 'text-slate-600 group-hover:text-slate-400'} />
                  <span>{label}</span>
                  {isActive && <ChevronRight size={12} className="ml-auto opacity-50" />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Alerts summary */}
        {(criticalCount > 0 || warnCount > 0) && (
          <div className="px-3 pb-3">
            <div className={`px-3 py-2 rounded-lg text-xs ${criticalCount > 0 ? 'alert-critical' : 'border border-warn/30 bg-warn/10'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <ShieldAlert size={12} className={criticalCount > 0 ? 'text-danger' : 'text-warn'} />
                <span className={`font-semibold ${criticalCount > 0 ? 'text-danger' : 'text-warn'}`}>
                  Active Alerts
                </span>
              </div>
              {criticalCount > 0 && <div className="text-danger/80">{criticalCount} critical</div>}
              {warnCount > 0 && <div className="text-warn/80">{warnCount} warnings</div>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-3 pb-4 border-t border-white/5 pt-3 space-y-2">
          {/* WS status */}
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-slate-600">
            {wsConnected
              ? <><Wifi size={11} className="text-success" /><span className="text-success/70">Live</span></>
              : <><WifiOff size={11} className="text-slate-600" /><span>Offline</span></>
            }
            <span className="ml-auto">{relativeTime(lastUpdated?.toISOString())}</span>
          </div>

          {/* User */}
          <div className="flex items-center gap-2.5 px-2 py-1">
            <div className="w-7 h-7 rounded-md bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-accent">
                {user?.username?.[0]?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-slate-300 truncate font-mono">{user?.username}</div>
              <div className="text-[10px] text-slate-600">{user?.isAdmin ? 'Admin' : 'Researcher'}</div>
            </div>
            <button onClick={logout} className="btn-ghost p-1 rounded-md" title="Sign out">
              <LogOut size={13} />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
