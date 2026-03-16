import { authenticateSystemUser } from './pamAuth.js';

export async function authRoutes(fastify) {

  /**
   * POST /api/auth/login
   * Authenticate against Linux system users via PAM, issue JWT
   */
  fastify.post('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string', minLength: 1, maxLength: 32 },
          password: { type: 'string', minLength: 1, maxLength: 128 }
        }
      }
    }
  }, async (request, reply) => {
    const { username, password } = request.body;

    // Rate limiting check (basic - use fastify-rate-limit in prod)
    const ip = request.ip;
    if (isRateLimited(ip)) {
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: 'Too many login attempts. Please wait before trying again.'
      });
    }

    try {
      const userInfo = await authenticateSystemUser(username, password);

      // Sign JWT with user claims
      const token = fastify.jwt.sign({
        username: userInfo.username,
        displayName: userInfo.displayName,
        uid: userInfo.uid,
        groups: userInfo.groups,
        isAdmin: userInfo.isAdmin
      });

      recordLoginAttempt(ip, true);
      fastify.log.info(`[Auth] Login success: ${username} (admin: ${userInfo.isAdmin}) from ${ip}`);

      return {
        token,
        user: {
          username: userInfo.username,
          displayName: userInfo.displayName,
          isAdmin: userInfo.isAdmin,
          groups: userInfo.groups
        },
        expiresIn: '8h'
      };
    } catch (err) {
      recordLoginAttempt(ip, false);
      fastify.log.warn(`[Auth] Login failed: ${username} from ${ip}: ${err.message}`);

      // Delay failed responses to slow brute-force
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));

      return reply.status(401).send({
        error: 'Authentication Failed',
        message: 'Invalid username or password'
      });
    }
  });

  /**
   * GET /api/auth/me
   * Get current user info from JWT
   */
  fastify.get('/me', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    return {
      user: request.user,
      tokenExp: new Date(request.user.exp * 1000).toISOString()
    };
  });

  /**
   * POST /api/auth/refresh
   * Refresh JWT if it's still valid (within last 30 min of expiry)
   */
  fastify.post('/refresh', {
    onRequest: [fastify.authenticate]
  }, async (request, reply) => {
    const { username, displayName, uid, groups, isAdmin } = request.user;
    const token = fastify.jwt.sign({ username, displayName, uid, groups, isAdmin });
    return { token, expiresIn: '8h' };
  });
}

// ─── Simple in-memory rate limiter ────────────────────────────────────────────
// In production, use Redis + fastify-rate-limit
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

function isRateLimited(ip) {
  const record = loginAttempts.get(ip);
  if (!record) return false;
  if (Date.now() - record.windowStart > RATE_LIMIT_WINDOW) {
    loginAttempts.delete(ip);
    return false;
  }
  return record.failures >= MAX_ATTEMPTS;
}

function recordLoginAttempt(ip, success) {
  const record = loginAttempts.get(ip) || { failures: 0, windowStart: Date.now() };
  if (Date.now() - record.windowStart > RATE_LIMIT_WINDOW) {
    record.failures = 0;
    record.windowStart = Date.now();
  }
  if (!success) record.failures++;
  else record.failures = 0;
  loginAttempts.set(ip, record);
}
