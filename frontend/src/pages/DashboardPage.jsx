import { useMetricsStore } from '../stores/metricsStore';
import AlertBanner from '../components/monitoring/AlertBanner';
import NodeCard from '../components/monitoring/NodeCard';
import UserResourceTable from '../components/monitoring/UserResourceTable';
import ThermalPanel from '../components/monitoring/ThermalPanel';
import StoragePanel from '../components/monitoring/StoragePanel';
import { Activity, RefreshCw } from 'lucide-react';
import { relativeTime } from '../utils/format';
import { useEffect } from 'react';

export default function DashboardPage() {
  const { metrics, alerts, lastUpdated, isLoading, fetchMetrics, fetchHistory } = useMetricsStore();

  useEffect(() => {
    fetchHistory('node1');
    fetchHistory('node2');
  }, []);

  return (
    <div className="p-6 space-y-5 min-h-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <Activity size={20} className="text-accent" />
            System Dashboard
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Real-time monitoring · 2 nodes · {alerts.length > 0 ? `${alerts.length} alerts` : 'All systems nominal'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600 font-mono">
            Updated {relativeTime(lastUpdated?.toISOString())}
          </span>
          <button
            onClick={fetchMetrics}
            disabled={isLoading}
            className="btn-ghost text-xs"
          >
            <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Alert Banner ── */}
      {alerts.length > 0 && <AlertBanner alerts={alerts} />}

      {/* ── Node Cards (side by side) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <NodeCard nodeId="node1" nodeData={metrics?.node1} />
        <NodeCard nodeId="node2" nodeData={metrics?.node2} />
      </div>

      {/* ── Thermal Deep-Dive ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <ThermalPanel nodeId="node1" nodeData={metrics?.node1} />
        <ThermalPanel nodeId="node2" nodeData={metrics?.node2} isMissionCritical />
      </div>

      {/* ── Storage ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <StoragePanel nodeId="node1" storage={metrics?.node1?.storage} />
        <StoragePanel nodeId="node2" storage={metrics?.node2?.storage} />
      </div>

      {/* ── Per-User Breakdown ── */}
      <UserResourceTable
        node1Users={metrics?.node1?.users}
        node2Users={metrics?.node2?.users}
        node1GpuData={metrics?.node1?.gpu}
        node2GpuData={metrics?.node2?.gpu}
      />
    </div>
  );
}
