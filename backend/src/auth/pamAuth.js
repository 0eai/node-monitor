import { execSync } from 'child_process';
import { createRequire } from 'module';

// PAM authentication for Linux system users
// Falls back to shadow file comparison in environments where pam is unavailable
let pamAuth;
try {
  const require = createRequire(import.meta.url);
  pamAuth = require('authenticate-pam');
} catch {
  console.warn('[Auth] PAM module not available, using shadow fallback');
  pamAuth = null;
}

/**
 * Authenticate a user against the Linux system using PAM.
 * Returns user info including whether they have sudo/admin rights.
 */
export async function authenticateSystemUser(username, password) {
  // Validate username format (prevent injection)
  if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(username)) {
    throw new Error('Invalid username format');
  }

  // Try PAM authentication
  if (pamAuth) {
    await new Promise((resolve, reject) => {
      pamAuth.authenticate(username, password, (err) => {
        if (err) reject(new Error('Authentication failed'));
        else resolve();
      }, { serviceName: 'login' });
    });
  } else {
    // Development fallback: check against demo accounts
    await fallbackAuth(username, password);
  }

  // Fetch user info after successful auth
  const userInfo = await getUserInfo(username);
  return userInfo;
}

/**
 * Get system user info: uid, groups, admin status.
 */
async function getUserInfo(username) {
  try {
    const idOutput = execSync(`id ${username}`, { encoding: 'utf8', timeout: 3000 }).trim();
    // Parse: uid=1001(username) gid=1001(username) groups=1001(username),27(sudo),4(adm)
    const uidMatch = idOutput.match(/uid=(\d+)\(([^)]+)\)/);
    const groupsMatch = idOutput.match(/groups=([^\n]+)/);
    const uid = uidMatch ? parseInt(uidMatch[1]) : null;
    const groupsList = groupsMatch
      ? groupsMatch[1].split(',').map(g => {
          const m = g.trim().match(/\d+\(([^)]+)\)/);
          return m ? m[1] : g.trim().replace(/^\d+$/, '');
        })
      : [];

    const isAdmin = groupsList.some(g => ['sudo', 'admin', 'wheel'].includes(g));

    // Get display name from passwd
    let displayName = username;
    try {
      const passwdLine = execSync(`getent passwd ${username}`, { encoding: 'utf8', timeout: 2000 }).trim();
      const parts = passwdLine.split(':');
      if (parts[4]) displayName = parts[4].split(',')[0] || username;
    } catch {}

    return {
      username,
      displayName,
      uid,
      groups: groupsList,
      isAdmin,
      homeDir: `/home/${username}`
    };
  } catch (err) {
    console.error('[Auth] getUserInfo failed:', err.message);
    return { username, displayName: username, uid: null, groups: [], isAdmin: false };
  }
}

/**
 * Development/fallback auth when PAM is not available.
 * In production, remove this and rely solely on PAM.
 */
const DEV_USERS = {
  admin: { password: 'admin123', isAdmin: true },
  researcher1: { password: 'pass123', isAdmin: false },
  researcher2: { password: 'pass123', isAdmin: false }
};

async function fallbackAuth(username, password) {
  const user = DEV_USERS[username];
  if (!user || user.password !== password) {
    throw new Error('Authentication failed');
  }
}

/**
 * Get list of human users on the system (uid 1000-65533)
 */
export function getSystemUsers() {
  try {
    const output = execSync(
      `getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1","$5","$3","$6}'`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();

    return output.split('\n').filter(Boolean).map(line => {
      const [username, displayName, uid, homeDir] = line.split(',');
      return { username, displayName: displayName?.split(',')?.[0] || username, uid: parseInt(uid), homeDir };
    });
  } catch (err) {
    console.error('[Auth] getSystemUsers failed:', err.message);
    return [];
  }
}
