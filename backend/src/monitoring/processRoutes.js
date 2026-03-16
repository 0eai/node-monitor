import { execOnNode } from '../ssh/sshManager.js';
import { metricsCache } from './scheduler.js';

export async function processRoutes(fastify) {
  fastify.addHook('onRequest', fastify.authenticate);

  /**
   * GET /api/processes/list
   * All heavy processes across both nodes with zombie flags
   */
  fastify.get('/list', async (request, reply) => {
    const cached = metricsCache.getAll();
    const processes = [];

    for (const nodeId of ['node1', 'node2']) {
      const nodeData = cached?.[nodeId];
      if (nodeData?.processes) {
        processes.push(...nodeData.processes);
      }
    }

    return {
      processes,
      zombieCount: processes.filter(p => p.isZombie).length,
      totalVramMiB: processes.reduce((sum, p) => sum + (p.vramMiB || 0), 0)
    };
  });

  /**
   * GET /api/processes/zombies
   * Only zombie processes
   */
  fastify.get('/zombies', async (request, reply) => {
    const cached = metricsCache.getAll();
    const zombies = [];

    for (const nodeId of ['node1', 'node2']) {
      const procs = cached?.[nodeId]?.processes || [];
      zombies.push(...procs.filter(p => p.isZombie));
    }

    return {
      zombies: zombies.sort((a, b) => b.vramMiB - a.vramMiB),
      totalWastedVramMiB: zombies.reduce((sum, p) => sum + p.vramMiB, 0)
    };
  });

  /**
   * POST /api/processes/kill
   * Kill a process (admin can kill any; users can only kill their own)
   */
  fastify.post('/kill', {
    schema: {
      body: {
        type: 'object',
        required: ['nodeId', 'pid'],
        properties: {
          nodeId: { type: 'string', enum: ['node1', 'node2'] },
          pid: { type: 'integer' },
          signal: { type: 'string', enum: ['SIGTERM', 'SIGKILL'], default: 'SIGTERM' },
          force: { type: 'boolean', default: false }
        }
      }
    }
  }, async (request, reply) => {
    const { nodeId, pid, signal = 'SIGTERM', force = false } = request.body;
    const { username, isAdmin } = request.user;

    // Check if user owns the process (unless admin)
    if (!isAdmin) {
      const cached = metricsCache.getAll();
      const proc = cached?.[nodeId]?.processes?.find(p => p.pid === pid);
      if (!proc) {
        return reply.status(404).send({ error: 'Process not found' });
      }
      if (proc.user !== username) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: `You can only kill your own processes. Process owned by: ${proc.user}`
        });
      }
    }

    const sigNum = force ? '9' : '15';
    const sigName = force ? 'SIGKILL (force)' : 'SIGTERM (graceful)';

    try {
      // Use sudo only if admin
      const killCmd = isAdmin
        ? `kill -${sigNum} ${pid} 2>&1 && echo "OK" || sudo kill -${sigNum} ${pid} 2>&1`
        : `kill -${sigNum} ${pid} 2>&1`;

      await execOnNode(nodeId, killCmd);

      fastify.log.info(`[Kill] User ${username} killed PID ${pid} on ${nodeId} with ${sigName}`);

      return {
        success: true,
        message: `Process ${pid} sent ${sigName}`,
        nodeId, pid, signal: sigName,
        killedBy: username,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return reply.status(500).send({
        error: 'Kill failed',
        message: err.message,
        hint: 'Process may have already terminated, or you lack permissions'
      });
    }
  });

  /**
   * POST /api/processes/kill-zombie-batch
   * Admin-only: kill all zombie processes on a node
   */
  fastify.post('/kill-zombie-batch', {
    onRequest: [fastify.requireAdmin],
    schema: {
      body: {
        type: 'object',
        required: ['nodeId'],
        properties: {
          nodeId: { type: 'string', enum: ['node1', 'node2'] },
          force: { type: 'boolean', default: false }
        }
      }
    }
  }, async (request, reply) => {
    const { nodeId, force = false } = request.body;
    const cached = metricsCache.getAll();
    const zombies = (cached?.[nodeId]?.processes || []).filter(p => p.isZombie);

    if (zombies.length === 0) {
      return { success: true, message: 'No zombie processes found', killed: 0 };
    }

    const sigNum = force ? '9' : '15';
    const pids = zombies.map(p => p.pid).join(' ');
    const cmd = `kill -${sigNum} ${pids} 2>&1 || true`;

    try {
      await execOnNode(nodeId, cmd);
      return {
        success: true,
        killed: zombies.length,
        pids: zombies.map(p => p.pid),
        freeingVramMiB: zombies.reduce((sum, p) => sum + p.vramMiB, 0),
        message: `Sent SIGTERM to ${zombies.length} zombie processes on ${nodeId}`
      };
    } catch (err) {
      return reply.status(500).send({ error: 'Batch kill failed', message: err.message });
    }
  });
}
