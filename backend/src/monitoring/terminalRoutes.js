import { Client } from 'ssh2';
import { readFileSync } from 'fs';
import { execSync, spawn } from 'child_process';

const LOCAL_NODE_ID = process.env.NODE_LOCAL_ID || 'node2';

const NODE_CONFIG = {
  node1: {
    host: process.env.NODE1_HOST || 'node1.example.com',
    port: parseInt(process.env.NODE1_SSH_PORT || '22'),
  },
  node2: {
    host: process.env.NODE2_HOST || 'node2.example.com',
    port: parseInt(process.env.NODE2_SSH_PORT || '22'),
  }
};

export async function terminalRoutes(fastify) {


  /**
   * GET /api/terminal/sessions/:nodeId
   * List existing tmux sessions on a node
   */
  fastify.get('/sessions/:nodeId', { onRequest: [fastify.authenticate] }, async (request, reply) => {
    const { nodeId } = request.params;
    const { username, isAdmin } = request.user;

    try {
      const sessions = await listTmuxSessions(nodeId, username, isAdmin);
      return { sessions, nodeId };
    } catch (err) {
      return { sessions: [], error: err.message };
    }
  });

  /**
   * WebSocket /api/terminal/attach
   * NOTE: This route is EXCLUDED from the onRequest authenticate hook above
   * because WebSocket connections cannot send Authorization headers.
   * JWT is verified manually from the ?token= query parameter instead.
   */
  fastify.get('/attach', {
    websocket: true,
    // IMPORTANT: Empty onRequest array bypasses ALL hooks for this route.
    // WebSocket upgrades cannot carry Authorization headers.
    // Auth is handled manually inside the handler using ?token= query param.
    onRequest: []
  }, (socket, req) => {
    const {
      token,
      nodeId = LOCAL_NODE_ID,
      sessionName,
      cols: qCols = '220',
      rows: qRows = '50'
    } = req.query;

    // Manually verify JWT from query param (WS can't use Authorization header)
    let user;
    try {
      if (!token) throw new Error('No token provided');
      user = fastify.jwt.verify(token);
    } catch (err) {
      sendJson(socket, { type: 'error', message: `Unauthorized: ${err.message}` });
      socket.close(1008, 'Unauthorized');
      return;
    }

    const targetSession = sessionName || user.username;

    // Permission check
    if (!user.isAdmin && targetSession !== user.username) {
      sendJson(socket, { type: 'error', message: 'You can only access your own terminal session' });
      socket.close(1008, 'Forbidden');
      return;
    }

    const cols = parseInt(qCols) || 220;
    const rows = parseInt(qRows) || 50;

    fastify.log.info(`[Terminal] ${user.username} → tmux:${targetSession} on ${nodeId} (${cols}x${rows})`);

    // Both local and remote use SSH shell — this ensures the terminal runs
    // with proper PTY allocation and correct user environment
    startSSHTerminal(socket, user, targetSession, nodeId, cols, rows, fastify.log);
  });
}

// ─── SSH Terminal (used for both local and remote nodes) ──────────────────────
//
// Even for the local node we SSH to localhost — this gives us:
//   1. Proper PTY allocation
//   2. Terminal runs as the ACTUAL user (not the Node.js process user)
//   3. Correct $HOME, conda env, PATH etc.
//   4. Consistent behaviour across local and remote nodes
//
function startSSHTerminal(socket, user, sessionName, nodeId, cols, rows, log) {
  const isLocal = nodeId === LOCAL_NODE_ID;
  const nodeConf = NODE_CONFIG[nodeId];

  const sshHost = isLocal ? '127.0.0.1' : nodeConf.host;
  // LOCAL_SSH_PORT allows using a non-standard SSH port on the local node
  // Set LOCAL_SSH_PORT=2222 in .env if sshd listens on 2222
  const sshPort = isLocal
    ? parseInt(process.env.LOCAL_SSH_PORT || process.env.NODE2_SSH_PORT || '22')
    : nodeConf.port;
  // For local: SSH as the web user themselves. For remote: SSH as monitor user.
  const sshUser = isLocal ? user.username : (process.env.SSH_USER || 'monitor');

  const conn = new Client();

  const connectConfig = {
    host: sshHost,
    port: sshPort,
    username: sshUser,
    readyTimeout: 10000,
    keepaliveInterval: 30000
  };

  // For local node: use the backend's SSH key (monitor key works if user has
  // authorized it, otherwise fall back to agent forwarding)
  // For remote node: always use the monitor key
  if (!isLocal || process.env.SSH_KEY_PATH) {
    try {
      if (process.env.SSH_KEY_PATH) {
        connectConfig.privateKey = readFileSync(process.env.SSH_KEY_PATH);
      }
    } catch (e) {
      log.warn(`[Terminal] Could not read SSH key: ${e.message}`);
    }
  }

  // For local connections, also try the agent
  if (isLocal) {
    connectConfig.agent = process.env.SSH_AUTH_SOCK;
  }

  const passEnv = nodeId === 'node1' ? process.env.NODE1_SSH_PASS : process.env.NODE2_SSH_PASS;
  if (!connectConfig.privateKey && passEnv) {
    connectConfig.password = passEnv;
  }

  log.info(`[Terminal] Connecting: ${sshUser}@${sshHost}:${sshPort} | key=${!!connectConfig.privateKey} | pass=${!!connectConfig.password} | agent=${connectConfig.agent || 'none'}`);

  conn.on('ready', () => {
    log.info(`[Terminal] SSH ready → ${sshUser}@${sshHost}:${sshPort}`);
    sendJson(socket, { type: 'log', message: `SSH connected to ${sshHost}:${sshPort} as ${sshUser}` });

    conn.shell({
      term: 'xterm-256color',
      cols,
      rows
    }, (err, stream) => {
      if (err) {
        log.error(`[Terminal] Shell error: ${err.message}`);
        sendJson(socket, { type: 'error', message: `Shell failed: ${err.message}` });
        conn.end();
        socket.close(1011, 'Shell error');
        return;
      }

      log.info(`[Terminal] Shell opened, sending tmux command for session: ${sessionName}`);
      sendJson(socket, { type: 'log', message: `Shell opened, attaching tmux:${sessionName}` });

      // Send the tmux attach command after a short delay for shell to init
      setTimeout(() => {
        const cmd = [
          `tmux has-session -t '${sessionName}' 2>/dev/null`,
          `|| tmux new-session -d -s '${sessionName}' -n main`,
          `&& tmux attach-session -t '${sessionName}'`,
          `|| tmux attach-session -t '${sessionName}'`
        ].join(' ');

        log.info(`[Terminal] Writing tmux cmd: ${cmd}`);
        stream.write(cmd + '\n');
      }, 300);

      // SSH stream → WebSocket (send raw binary for xterm.js)
      stream.on('data', data => {
        if (socket.readyState === 1) {
          socket.send(data);
        }
      });

      stream.stderr.on('data', data => {
        if (socket.readyState === 1) {
          socket.send(data);
        }
      });

      // WebSocket → SSH stream
      socket.on('message', msg => {
        try {
          // Try JSON first (structured messages from frontend)
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === 'input') {
            stream.write(parsed.data);
          } else if (parsed.type === 'resize') {
            const newCols = parseInt(parsed.cols) || cols;
            const newRows = parseInt(parsed.rows) || rows;
            stream.setWindow(newRows, newCols, 0, 0);
          }
        } catch {
          // Raw input — write directly to stream
          stream.write(msg);
        }
      });

      stream.on('close', () => {
        log.info(`[Terminal] Stream closed for ${user.username}:${sessionName}`);
        conn.end();
        if (socket.readyState === 1) socket.close(1000, 'Session ended');
      });

      stream.on('error', err => {
        log.error(`[Terminal] Stream error: ${err.message}`);
        conn.end();
      });

      socket.on('close', () => {
        log.info(`[Terminal] WebSocket closed for ${user.username}`);
        stream.close();
        conn.end();
      });

      socket.on('error', () => {
        stream.close();
        conn.end();
      });

      // Notify frontend — connected
      sendJson(socket, {
        type: 'connected',
        message: `Connected · tmux session: ${sessionName}`,
        sessionName,
        nodeId
      });
    });
  });

  conn.on('error', err => {
    log.error(`[Terminal] SSH connection error for ${sshUser}@${sshHost}:${sshPort} — ${err.message}`);
    log.error(`[Terminal] connectConfig was: host=${sshHost} port=${sshPort} user=${sshUser} hasKey=${!!connectConfig.privateKey} hasPass=${!!connectConfig.password} agent=${connectConfig.agent}`);
    sendJson(socket, {
      type: 'error',
      message: `SSH failed: ${err.message}`,
      detail: `Tried ${sshUser}@${sshHost}:${sshPort} | key=${!!connectConfig.privateKey} | pass=${!!connectConfig.password}`,
      hint: isLocal
        ? `Check: ssh -p ${sshPort} ${sshUser}@localhost "echo ok" — and ensure LOCAL_SSH_PORT=${sshPort} in .env`
        : `Check: ssh -i $SSH_KEY_PATH -p ${sshPort} ${sshUser}@${sshHost} "echo ok"`
    });
    if (socket.readyState === 1) socket.close(1011, 'SSH error');
  });

  conn.on('close', () => {
    log.info(`[Terminal] SSH connection closed`);
    if (socket.readyState === 1) socket.close(1000, 'SSH closed');
  });

  conn.connect(connectConfig);
}

// ─── List tmux sessions ────────────────────────────────────────────────────────
async function listTmuxSessions(nodeId, username, isAdmin) {
  const { execOnNode } = await import('../ssh/sshManager.js');
  const isLocal = nodeId === LOCAL_NODE_ID;

  const cmd = `tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_attached}|#{session_created}" 2>/dev/null || echo "NO_SESSIONS"`;

  let output;
  try {
    output = isLocal
      ? execSync(cmd, { encoding: 'utf8', timeout: 5000 }).trim()
      : await execOnNode(nodeId, cmd);
  } catch {
    return [];
  }

  if (!output || output.includes('NO_SESSIONS')) return [];

  return output.split('\n')
    .filter(Boolean)
    .map(line => {
      const [name, windows, attached, created] = line.split('|');
      return {
        name,
        windows: parseInt(windows) || 1,
        attached: attached === '1',
        created: created ? new Date(parseInt(created) * 1000).toISOString() : null,
        isOwn: name === username
      };
    })
    .filter(s => isAdmin || s.name === username || s.name.startsWith(`${username}-`));
}

function sendJson(socket, obj) {
  try {
    if (socket.readyState === 1) {
      socket.send(JSON.stringify(obj));
    }
  } catch {}
}