import { Client } from 'ssh2';
import dotenv from 'dotenv';

dotenv.config();

/**
 * SSH Connection Pool
 * Maintains persistent SSH connections to both lab nodes.
 * Automatically reconnects on failure with exponential backoff.
 */

export const NODES = {
  node1: {
    id: 'node1',
    label: 'dilab (Node 1)',
    host: process.env.NODE1_HOST || 'dilab.ssghu.ac.kr',
    port: parseInt(process.env.NODE1_SSH_PORT || '22'),
    username: process.env.SSH_USER || 'monitor',
    privateKey: process.env.SSH_KEY_PATH
      ? (await import('fs')).readFileSync(process.env.SSH_KEY_PATH)
      : undefined,
    password: process.env.NODE1_SSH_PASS,
    specs: {
      gpus: ['RTX 3090', 'RTX 3090'],
      cores: 18,
      ramGB: 251,
      gpuThermalCritical: false
    }
  },
  node2: {
    id: 'node2',
    label: 'dilab2 (Node 2)',
    host: process.env.NODE2_HOST || 'dilab2.ssghu.ac.kr',
    port: parseInt(process.env.NODE2_SSH_PORT || '22'),
    username: process.env.SSH_USER || 'monitor',
    privateKey: process.env.SSH_KEY_PATH
      ? (await import('fs')).readFileSync(process.env.SSH_KEY_PATH)
      : undefined,
    password: process.env.NODE2_SSH_PASS,
    specs: {
      gpus: ['RTX 4090', 'RTX 4090', 'RTX 4090', 'RTX 4090'],
      cores: 40,
      ramGB: 440,
      // Node 2 recently had cooling repairs — thermal monitoring is mission-critical
      gpuThermalCritical: true
    }
  }
};

// Connection pool state
const connections = new Map();
const reconnectTimers = new Map();
const MAX_RECONNECT_DELAY = 30000;

/**
 * Create and store a persistent SSH connection for a node.
 */
function createConnection(nodeId) {
  const nodeConfig = NODES[nodeId];
  if (!nodeConfig) throw new Error(`Unknown node: ${nodeId}`);

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let resolved = false;

    conn.on('ready', () => {
      console.log(`[SSH] Connected to ${nodeConfig.label}`);
      connections.set(nodeId, { conn, status: 'connected', reconnectAttempts: 0 });
      clearReconnectTimer(nodeId);
      resolved = true;
      resolve(conn);
    });

    conn.on('error', (err) => {
      console.error(`[SSH] Error on ${nodeConfig.label}:`, err.message);
      connections.set(nodeId, { conn: null, status: 'error', error: err.message });
      scheduleReconnect(nodeId);
      if (!resolved) reject(err);
    });

    conn.on('close', () => {
      console.warn(`[SSH] Connection closed for ${nodeConfig.label}`);
      connections.set(nodeId, { conn: null, status: 'disconnected' });
      scheduleReconnect(nodeId);
    });

    const connectConfig = {
      host: nodeConfig.host,
      port: nodeConfig.port,
      username: nodeConfig.username,
      readyTimeout: 10000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3
    };

    if (nodeConfig.privateKey) {
      connectConfig.privateKey = nodeConfig.privateKey;
    } else if (nodeConfig.password) {
      connectConfig.password = nodeConfig.password;
    }

    conn.connect(connectConfig);
  });
}

function clearReconnectTimer(nodeId) {
  if (reconnectTimers.has(nodeId)) {
    clearTimeout(reconnectTimers.get(nodeId));
    reconnectTimers.delete(nodeId);
  }
}

function scheduleReconnect(nodeId) {
  clearReconnectTimer(nodeId);
  const state = connections.get(nodeId);
  const attempts = state?.reconnectAttempts || 0;
  const delay = Math.min(1000 * Math.pow(2, attempts), MAX_RECONNECT_DELAY);

  console.log(`[SSH] Reconnecting to ${nodeId} in ${delay}ms (attempt ${attempts + 1})`);
  const timer = setTimeout(async () => {
    connections.set(nodeId, { conn: null, status: 'reconnecting', reconnectAttempts: attempts + 1 });
    try {
      await createConnection(nodeId);
    } catch (err) {
      console.error(`[SSH] Reconnect failed for ${nodeId}:`, err.message);
    }
  }, delay);
  reconnectTimers.set(nodeId, timer);
}

/**
 * Initialize SSH connections to all nodes.
 */
export async function initSSHConnections() {
  console.log('[SSH] Initializing connections to all nodes...');
  const results = await Promise.allSettled(
    Object.keys(NODES).map(nodeId => createConnection(nodeId))
  );
  results.forEach((result, i) => {
    const nodeId = Object.keys(NODES)[i];
    if (result.status === 'rejected') {
      console.error(`[SSH] Initial connection to ${nodeId} failed:`, result.reason.message);
    }
  });
}

/**
 * Execute a command on a specific node via SSH.
 * Returns stdout as string.
 */
export function execOnNode(nodeId, command, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const state = connections.get(nodeId);
    if (!state?.conn) {
      return reject(new Error(`No active SSH connection to ${nodeId}`));
    }

    const { conn } = state;
    let output = '';
    let errOutput = '';

    conn.exec(command, { pty: false }, (err, stream) => {
      if (err) return reject(err);

      const timer = setTimeout(() => {
        stream.destroy();
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
      }, timeoutMs);

      stream
        .on('data', (data) => { output += data.toString(); })
        .stderr.on('data', (data) => { errOutput += data.toString(); });

      stream.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0 && !output) {
          reject(new Error(`Command failed (exit ${code}): ${errOutput || 'no output'}`));
        } else {
          resolve(output.trim());
        }
      });
    });
  });
}

/**
 * Execute a command on ALL nodes concurrently.
 * Returns object: { node1: result|error, node2: result|error }
 */
export async function execOnAllNodes(command, timeoutMs = 15000) {
  const results = await Promise.allSettled(
    Object.keys(NODES).map(nodeId => execOnNode(nodeId, command, timeoutMs))
  );
  return Object.fromEntries(
    Object.keys(NODES).map((nodeId, i) => [
      nodeId,
      results[i].status === 'fulfilled'
        ? { success: true, data: results[i].value }
        : { success: false, error: results[i].reason.message }
    ])
  );
}

/**
 * Get the current connection status of all nodes.
 */
export function getConnectionStatus() {
  return Object.fromEntries(
    Object.keys(NODES).map(nodeId => {
      const state = connections.get(nodeId);
      return [nodeId, {
        status: state?.status || 'unknown',
        error: state?.error || null,
        label: NODES[nodeId].label,
        specs: NODES[nodeId].specs
      }];
    })
  );
}

/**
 * Execute a long-running command (like rsync) with streaming output.
 * Calls onData(chunk) for each output chunk, resolves when done.
 */
export function execStreamOnNode(nodeId, command, onData, onError) {
  return new Promise((resolve, reject) => {
    const state = connections.get(nodeId);
    if (!state?.conn) {
      return reject(new Error(`No active SSH connection to ${nodeId}`));
    }

    state.conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      stream.on('data', (data) => onData(data.toString()));
      stream.stderr.on('data', (data) => onError?.(data.toString()));
      stream.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Command exited with code ${code}`));
      });
    });
  });
}
