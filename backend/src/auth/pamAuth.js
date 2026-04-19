import { execSync, exec, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

// Path to the Python helper script (same directory as this file)
const VERIFY_SCRIPT = join(__dirname, 'verifyPassword.py');

/**
 * Authenticate a user against the Linux system.
 *
 * For local users: uses Python crypt + spwd to verify against /etc/shadow
 *   Requires backend user in shadow group:
 *   sudo usermod -aG shadow $USER  (then re-login or: exec su -l $USER)
 *
 * For remote-only users: uses sshpass SSH password auth
 *   sudo apt install sshpass
 */
export async function authenticateSystemUser(username, password) {
  if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(username)) {
    throw new Error('Invalid username format');
  }

  const existsLocally = userExistsLocally(username);

  if (existsLocally) {
    await authenticateViaPython(username, password);
    return getUserInfo(username);
  }

  // User not local — try remote nodes via sshpass
  const remoteNodes = [
    {
      host: process.env.NODE1_HOST || 'node1.example.com',
      port: process.env.NODE1_SSH_PORT || '22',
      label: process.env.NODE1_LABEL || 'Node 1'
    }
  ];

  for (const node of remoteNodes) {
    const result = await trySSHAuth(username, password, node);
    if (result.success) {
      console.log(`[Auth] ${username} authenticated via SSH on ${node.label}`);
      return result.userInfo;
    }
  }

  throw new Error('Authentication failed');
}

/**
 * Verify password using Python's crypt + spwd modules.
 * Works with all hash types including yescrypt ($y$), SHA-512 ($6$), bcrypt ($2b$).
 * Requires the backend user to be in the 'shadow' group.
 */
function authenticateViaPython(username, password) {
  return new Promise((resolve, reject) => {
    // Pass password via stdin to avoid it appearing in process list
    const child = spawn('/usr/bin/python3', [VERIFY_SCRIPT, username], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderr = '';
    child.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Authentication timed out'));
    }, 5000);

    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else if (code === 2) {
        // Script error (permission denied, user not found)
        console.error(`[Auth] Password verify error: ${stderr.trim()}`);
        reject(new Error(stderr.trim() || 'Authentication error'));
      } else {
        reject(new Error('Authentication failed'));
      }
    });

    // Send password via stdin
    child.stdin.write(password + '\n');
    child.stdin.end();
  });
}

/**
 * SSH password auth against a remote node using sshpass.
 * Install: sudo apt install sshpass
 */
async function trySSHAuth(username, password, node) {
  if (!(await commandExists('sshpass'))) {
    console.warn('[Auth] sshpass not installed — remote user auth unavailable. Run: sudo apt install sshpass');
    return { success: false };
  }

  try {
    const { stdout } = await execAsync(
      `sshpass -p ${shellEscape(password)} ssh` +
      ` -o StrictHostKeyChecking=no` +
      ` -o ConnectTimeout=5` +
      ` -o BatchMode=no` +
      ` -o PreferredAuthentications=password` +
      ` -o PubkeyAuthentication=no` +
      ` -p ${node.port} ${username}@${node.host} id`,
      { timeout: 8000 }
    );
    const userInfo = parseIdOutput(username, stdout.trim(), node.label);
    return { success: true, userInfo };
  } catch {
    return { success: false };
  }
}

function shellEscape(str) {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function parseIdOutput(username, idOutput, nodeLabel) {
  const uidMatch = idOutput.match(/uid=(\d+)\(([^)]+)\)/);
  const groupsMatch = idOutput.match(/groups=([^\n]+)/);
  const uid = uidMatch ? parseInt(uidMatch[1]) : null;
  const groupsList = groupsMatch
    ? groupsMatch[1].split(',').map(g => {
        const m = g.trim().match(/\d+\(([^)]+)\)/);
        return m ? m[1] : null;
      }).filter(Boolean)
    : [];
  const isAdmin = groupsList.some(g => ['sudo', 'admin', 'wheel'].includes(g));
  return {
    username,
    displayName: username,
    uid,
    groups: groupsList,
    isAdmin,
    homeDir: `/home/${username}`,
    authenticatedVia: nodeLabel
  };
}

function userExistsLocally(username) {
  try {
    execSync(`getent passwd ${username}`, { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function commandExists(cmd) {
  try {
    await execAsync(`which ${cmd}`, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export function getUserInfo(username) {
  try {
    const idOutput = execSync(`id ${username}`, { encoding: 'utf8', timeout: 3000 }).trim();
    return parseIdOutput(username, idOutput, 'local');
  } catch (err) {
    console.error('[Auth] getUserInfo failed:', err.message);
    return { username, displayName: username, uid: null, groups: [], isAdmin: false };
  }
}

export function getSystemUsers() {
  try {
    const output = execSync(
      `getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1","$5","$3","$6}'`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    return output.split('\n').filter(Boolean).map(line => {
      const [username, displayName, uid, homeDir] = line.split(',');
      return {
        username,
        displayName: displayName?.split(',')?.[0] || username,
        uid: parseInt(uid),
        homeDir
      };
    });
  } catch (err) {
    console.error('[Auth] getSystemUsers failed:', err.message);
    return [];
  }
}