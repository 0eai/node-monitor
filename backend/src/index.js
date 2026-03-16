import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import dotenv from 'dotenv';
import { authRoutes } from './auth/routes.js';
import { monitoringRoutes } from './monitoring/routes.js';
import { datasetRoutes } from './datasets/routes.js';
import { processRoutes } from './monitoring/processRoutes.js';
import { startMonitoringScheduler } from './monitoring/scheduler.js';
import { initDatabase } from './utils/database.js';

dotenv.config();

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: { colorize: true }
    }
  }
});

// ─── Plugins ──────────────────────────────────────────────────────────────────
await fastify.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
});

await fastify.register(jwt, {
  secret: process.env.JWT_SECRET || 'dilab-super-secret-change-in-production-please',
  sign: { expiresIn: '8h' }
});

await fastify.register(websocket);
await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Auth Decorator ────────────────────────────────────────────────────────────
fastify.decorate('authenticate', async function (request, reply) {
  try {
    await request.jwtVerify();
  } catch (err) {
    reply.status(401).send({ error: 'Unauthorized', message: 'Valid JWT required' });
  }
});

fastify.decorate('requireAdmin', async function (request, reply) {
  await fastify.authenticate(request, reply);
  if (!request.user?.isAdmin) {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin privileges required' });
  }
});

// ─── Routes ────────────────────────────────────────────────────────────────────
await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(monitoringRoutes, { prefix: '/api/monitoring' });
await fastify.register(processRoutes, { prefix: '/api/processes' });
await fastify.register(datasetRoutes, { prefix: '/api/datasets' });

// ─── WebSocket for real-time metrics ─────────────────────────────────────────
fastify.register(async function (fastify) {
  fastify.get('/ws/metrics', { websocket: true }, (socket, req) => {
    // Verify JWT from query param for WS connections
    const token = req.query.token;
    try {
      fastify.jwt.verify(token);
    } catch {
      socket.close(1008, 'Unauthorized');
      return;
    }

    const { broadcastMetrics } = await import('./monitoring/broadcaster.js');
    broadcastMetrics.addClient(socket);

    socket.on('close', () => {
      broadcastMetrics.removeClient(socket);
    });
  });
});

// ─── Health check ──────────────────────────────────────────────────────────────
fastify.get('/api/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: '1.0.0'
}));

// ─── Init ──────────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    await initDatabase();
    await startMonitoringScheduler();

    const port = parseInt(process.env.PORT || '3001');
    const host = process.env.HOST || '0.0.0.0';
    await fastify.listen({ port, host });
    fastify.log.info(`🚀 DILab Monitor API running on http://${host}:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
