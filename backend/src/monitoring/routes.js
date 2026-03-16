import { fetchFullNodeSnapshot, fetchGPUMetrics } from './monitoringService.js';
import { getConnectionStatus } from '../ssh/sshManager.js';
import { metricsCache } from './scheduler.js';

export async function monitoringRoutes(fastify) {
  // All monitoring routes require auth
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * GET /api/monitoring/status
   * SSH connection status for all nodes
   */
  fastify.get('/status', async (request, reply) => {
    return getConnectionStatus();
  });

  /**
   * GET /api/monitoring/all
   * Full snapshot of all nodes (served from cache, updated every 5s)
   */
  fastify.get('/all', async (request, reply) => {
    const cached = metricsCache.getAll();
    if (cached) return cached;

    // Cache miss - fetch live
    const [node1, node2] = await Promise.allSettled([
      fetchFullNodeSnapshot('node1'),
      fetchFullNodeSnapshot('node2')
    ]);

    return {
      node1: node1.status === 'fulfilled' ? node1.value : { error: node1.reason?.message },
      node2: node2.status === 'fulfilled' ? node2.value : { error: node2.reason?.message },
      timestamp: new Date().toISOString()
    };
  });

  /**
   * GET /api/monitoring/node/:nodeId
   * Full snapshot for a specific node
   */
  fastify.get('/node/:nodeId', {
    schema: {
      params: {
        type: 'object',
        properties: { nodeId: { type: 'string', enum: ['node1', 'node2'] } }
      }
    }
  }, async (request, reply) => {
    const { nodeId } = request.params;
    const cached = metricsCache.getNode(nodeId);
    if (cached) return cached;
    return fetchFullNodeSnapshot(nodeId);
  });

  /**
   * GET /api/monitoring/alerts
   * All active alerts across both nodes
   */
  fastify.get('/alerts', async (request, reply) => {
    const cached = metricsCache.getAll();
    const alerts = [];
    if (cached?.node1?.alerts) alerts.push(...cached.node1.alerts);
    if (cached?.node2?.alerts) alerts.push(...cached.node2.alerts);
    return {
      alerts: alerts.sort((a, b) => {
        const priority = { critical: 0, warning: 1, info: 2 };
        return (priority[a.type] || 2) - (priority[b.type] || 2);
      }),
      count: alerts.length,
      criticalCount: alerts.filter(a => a.type === 'critical').length
    };
  });

  /**
   * GET /api/monitoring/historical/:nodeId
   * Last N snapshots (in-memory ring buffer)
   */
  fastify.get('/historical/:nodeId', async (request, reply) => {
    const { nodeId } = request.params;
    const { limit = 60 } = request.query;
    return metricsCache.getHistory(nodeId, parseInt(limit));
  });
}