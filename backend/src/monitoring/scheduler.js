import cron from 'node-cron';
import { fetchFullNodeSnapshot } from './monitoringService.js';
import { initSSHConnections } from '../ssh/sshManager.js';

// ─── In-Memory Metrics Cache ───────────────────────────────────────────────────
const HISTORY_SIZE = 360; // 30 min @ 5s intervals

class MetricsCache {
  constructor() {
    this.latest = null;
    this.history = { node1: [], node2: [] };
    this.lastUpdated = null;
  }

  update(data) {
    this.latest = data;
    this.lastUpdated = new Date();

    for (const nodeId of ['node1', 'node2']) {
      if (data[nodeId] && !data[nodeId].error) {
        const snap = {
          timestamp: data[nodeId].timestamp,
          cpuUsagePct: data[nodeId].system?.cpuUsagePct,
          memUsedPct: data[nodeId].system?.memUsedPct,
          gpuTemps: data[nodeId].gpu?.gpus?.map(g => g.tempC),
          gpuUtils: data[nodeId].gpu?.gpus?.map(g => g.utilizationGpuPct),
          gpuMemPcts: data[nodeId].gpu?.gpus?.map(g => g.memUsedPct),
          loadAvg1: data[nodeId].system?.loadAvg1
        };
        this.history[nodeId].push(snap);
        if (this.history[nodeId].length > HISTORY_SIZE) {
          this.history[nodeId].shift();
        }
      }
    }
  }

  getAll() {
    if (!this.latest) return null;
    // Cache is valid for 8 seconds
    if (this.lastUpdated && Date.now() - this.lastUpdated.getTime() > 8000) return null;
    return this.latest;
  }

  getNode(nodeId) {
    if (!this.latest?.[nodeId]) return null;
    if (this.lastUpdated && Date.now() - this.lastUpdated.getTime() > 8000) return null;
    return this.latest[nodeId];
  }

  getHistory(nodeId, limit = 60) {
    const hist = this.history[nodeId] || [];
    return hist.slice(-limit);
  }
}

export const metricsCache = new MetricsCache();

// Broadcast clients (WebSocket)
export const broadcastMetrics = {
  clients: new Set(),
  addClient(socket) { this.clients.add(socket); },
  removeClient(socket) { this.clients.delete(socket); },
  send(data) {
    const payload = JSON.stringify(data);
    for (const client of this.clients) {
      try {
        if (client.readyState === 1) client.send(payload);
      } catch { this.clients.delete(client); }
    }
  }
};

let isPolling = false;

async function pollAllNodes() {
  if (isPolling) return; // Skip if previous poll hasn't finished
  isPolling = true;
  try {
    const [node1, node2] = await Promise.allSettled([
      fetchFullNodeSnapshot('node1'),
      fetchFullNodeSnapshot('node2')
    ]);

    const data = {
      node1: node1.status === 'fulfilled' ? node1.value : { error: node1.reason?.message, nodeId: 'node1' },
      node2: node2.status === 'fulfilled' ? node2.value : { error: node2.reason?.message, nodeId: 'node2' },
      timestamp: new Date().toISOString()
    };

    metricsCache.update(data);
    broadcastMetrics.send({ type: 'metrics_update', data });
  } catch (err) {
    console.error('[Scheduler] Poll error:', err.message);
  } finally {
    isPolling = false;
  }
}

export async function startMonitoringScheduler() {
  // Connect SSH first
  await initSSHConnections();

  // Do an initial poll immediately
  await pollAllNodes();

  // Then poll every 5 seconds
  cron.schedule('*/5 * * * * *', pollAllNodes);

  console.log('[Scheduler] Monitoring scheduler started (5s interval)');
}
