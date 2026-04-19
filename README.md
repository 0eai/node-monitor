# DILab Server Monitor

> **Full-stack server management and monitoring platform for the DILab AI Research Lab.**
> Real-time GPU thermals, VRAM zombie detection, tmux terminal, per-user resource tracking,
> open ports, SSH sessions, storage analytics, and a collaborative dataset hub —
> across both Ubuntu 22.04 nodes via live WebSocket streaming.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Directory Structure](#directory-structure)
3. [Tech Stack](#tech-stack)
4. [Step-by-Step Setup](#step-by-step-setup)
5. [Authentication Flow](#authentication-flow)
6. [Feature Access & Permission Model](#feature-access--permission-model)
7. [Adding & Removing Nodes](#adding--removing-nodes)
8. [Feature Guide](#feature-guide)
9. [SSH Monitor User Setup](#ssh-monitor-user-setup)
10. [Deployment](#deployment)
11. [Security Notes](#security-notes)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Browser (Researcher)                        │
│  React 18 + Vite + Tailwind  ·  Zustand  ·  TanStack Query     │
│  xterm.js (terminal)  ·  Recharts  ·  WebSocket (live metrics)  │
└──────────────────────────────┬──────────────────────────────────┘
                               │ HTTP + WebSocket
┌──────────────────────────────▼──────────────────────────────────┐
│                  Node.js Backend  (Fastify)                     │
│                  Hosted on dilab2.ssghu.ac.kr                   │
│                                                                 │
│  /api/auth        ── PAM/shadow auth → JWT (8h TTL)            │
│  /api/monitoring  ── Cached snapshots + historical ring buf     │
│  /api/processes   ── List, zombie-detect, kill                  │
│  /api/extras      ── Ports, SSH sessions, storage-by-user       │
│  /api/datasets    ── CRUD + rsync SSE sync                      │
│  /api/terminal    ── tmux WebSocket bridge (xterm.js)           │
│  /ws/metrics      ── WebSocket broadcast (5s interval)          │
│                                                                 │
│  node-cron (5s) ──► SSH Manager ──► MetricsCache ──► WS push   │
│                                                                 │
└───────────────┬──────────────────────────┬──────────────────────┘
                │ SSH (ssh2) port 2222      │ local child_process
                │                          │ (NODE_LOCAL_ID=node2)
┌───────────────▼──────────┐  ┌────────────▼────────────────────┐
│   dilab (Node 1)         │  │   dilab2 (Node 2) — LOCAL       │
│   dilab.ssu.ac.kr:2222   │  │   dilab2.ssghu.ac.kr            │
│   2× RTX 3090            │  │   4× RTX 4090                   │
│   18 cores / 251 GB RAM  │  │   40 cores / 440 GB RAM         │
│                          │  │   ⚠ Post-cooling repair:        │
│   monitor user (SSH)     │  │     thermal priority active     │
└──────────────────────────┘  └─────────────────────────────────┘
```

**Data flow for live metrics:**
1. `node-cron` fires every 5 seconds
2. Scheduler fetches both nodes **concurrently** via `Promise.allSettled`
3. dilab2 runs commands via local `child_process.exec` (zero SSH overhead)
4. dilab runs commands over the persistent SSH connection
5. Parsed data stored in `MetricsCache` (360-entry ring buffer = 30 min history)
6. Broadcast to all connected WebSocket clients atomically

---

## Directory Structure

```
dilab-monitor/
├── README.md
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── index.js                      # Fastify server + plugin registration
│       ├── auth/
│       │   ├── pamAuth.js                # Python crypt + sshpass auth strategy
│       │   ├── routes.js                 # POST /login, GET /me, POST /refresh
│       │   └── verifyPassword.py         # /etc/shadow verifier (Python 3.13+ safe)
│       ├── monitoring/
│       │   ├── monitoringService.js      # All SSH command parsers + zombie detection
│       │   ├── routes.js                 # GET /all, /node/:id, /alerts, /historical
│       │   ├── processRoutes.js          # GET /list, /zombies; POST /kill, /kill-batch
│       │   ├── extrasRoutes.js           # GET /ports, /ssh-sessions, /storage-by-user
│       │   ├── terminalRoutes.js         # WebSocket tmux bridge
│       │   └── scheduler.js             # node-cron polling + MetricsCache + WS broadcast
│       ├── ssh/
│       │   └── sshManager.js            # Connection pool, local/remote exec routing
│       ├── datasets/
│       │   └── routes.js                # CRUD + rsync SSE streaming
│       └── utils/
│           └── database.js              # better-sqlite3 init + schema + tag seeds
│
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx                       # Router + WS init + QueryClient
        ├── index.css                     # Tailwind + custom CSS vars + animations
        ├── hooks/
        │   └── usePermissions.js         # ★ Centralized permission matrix
        ├── pages/
        │   ├── LoginPage.jsx             # System credential form
        │   ├── DashboardPage.jsx         # Overview: nodes, thermals, ports, SSH, users
        │   ├── ProcessesPage.jsx         # Processes, VRAM, zombies, kill switch
        │   ├── StoragePage.jsx           # Filesystem overview + per-user usage + chart
        │   ├── DatasetsPage.jsx          # Dataset hub: register, tag, markdown, sync
        │   └── TerminalPage.jsx          # xterm.js + tmux multi-tab terminal
        ├── components/
        │   ├── dashboard/
        │   │   └── Layout.jsx            # Sidebar nav + status pills + alert count
        │   └── monitoring/
        │       ├── AlertBanner.jsx       # Flashing critical/warning banner
        │       ├── NodeCard.jsx          # Per-node card with sparklines
        │       ├── ThermalPanel.jsx      # GPU arc gauges + CPU core grid
        │       ├── StoragePanel.jsx      # Filesystem bars
        │       ├── UserResourceTable.jsx # Per-user CPU/RAM/VRAM table
        │       ├── OpenPortsCard.jsx     # Listening ports with process/user info
        │       └── SSHSessionsCard.jsx   # Active sessions + recent login history
        ├── stores/
        │   ├── authStore.js              # Zustand auth (persisted JWT)
        │   └── metricsStore.js           # WS client + metrics state + history buffer
        └── utils/
            ├── api.js                    # Axios instance + 401 interceptor
            └── format.js                # formatMiB, getThermalColor, relativeTime…
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + Vite | Fast HMR, modern React |
| Styling | Tailwind CSS v3 | Utility-first dark theme |
| Terminal | xterm.js v5 | Full VT100/256-color PTY rendering |
| Charts | Recharts | Composable area/line/bar charts |
| State | Zustand | Minimal boilerplate, persist middleware |
| Data fetching | TanStack Query | Auto-refetch, mutation cache |
| Real-time | Native WebSocket | Direct push, minimal overhead |
| Backend | Fastify v4 | High-throughput, schema validation |
| SSH | ssh2 | Persistent connections, exec + PTY shell |
| Auth | Python crypt + sshpass | No native modules, works with yescrypt |
| Database | better-sqlite3 | Zero-config, fast, dataset metadata |
| Scheduler | node-cron | 5-second polling trigger |

---

## Step-by-Step Setup

### Prerequisites

```bash
# On dilab2 (backend host):
sudo apt install -y libpam-dev build-essential pamtester sshpass tmux
pip install crypt-r           # Python 3.13+ yescrypt support

# Shadow group for password verification:
sudo usermod -aG shadow $USER
exec su -l $USER              # apply without logout

# Sudoers for monitoring commands (backend user on dilab2):
cat << 'EOF' | sudo tee /etc/sudoers.d/dilab-monitor
# Storage monitoring
$USER ALL=(ALL) NOPASSWD: /usr/bin/du

# Port monitoring - required for process/user info on all ports
$USER ALL=(ALL) NOPASSWD: /usr/bin/ss
$USER ALL=(ALL) NOPASSWD: /usr/bin/netstat
$USER ALL=(ALL) NOPASSWD: /usr/bin/ps
EOF
sudo chmod 440 /etc/sudoers.d/dilab-monitor

# On dilab (node1) — install tools the monitor user will run:
sudo apt install -y lm-sensors nvidia-utils-535 tmux
sudo sensors-detect --auto
```

### 1. Clone & configure

```bash
git clone <repo> dilab-monitor && cd dilab-monitor
cp backend/.env.example backend/.env
nano backend/.env   # set JWT_SECRET, SSH_KEY_PATH, NODE_LOCAL_ID=node2
```

### 2. SSH key setup (for dilab / node1 only)

```bash
# Generate key on dilab2:
ssh-keygen -t ed25519 -C "dilab-monitor" -f ~/.ssh/dilab_monitor -N ""

# Copy to dilab via your own account:
ssh -p 2222 yourname@dilab.ssu.ac.kr
sudo mkdir -p /home/monitor/.ssh
sudo bash -c 'cat >> /home/monitor/.ssh/authorized_keys' << 'KEY'
PASTE_CONTENT_OF_~/.ssh/dilab_monitor.pub_HERE
KEY
sudo chmod 700 /home/monitor/.ssh
sudo chmod 600 /home/monitor/.ssh/authorized_keys
sudo chown -R monitor:monitor /home/monitor/.ssh
sudo usermod -s /bin/bash monitor

# Test:
ssh -i ~/.ssh/dilab_monitor -p 2222 monitor@dilab.ssu.ac.kr "whoami"
```

### 3. Install & run

```bash
# Backend:
cd backend && npm install && npm run dev

# Frontend (separate terminal):
cd frontend && npm install && npm run dev
# → http://localhost:5173
```

### 4. Login

Use any Linux system account on dilab2. Admin access is granted automatically for users in the `sudo` group.

---

## Authentication Flow

```
Browser                    Backend                      Linux OS
  │                           │                             │
  │  POST /api/auth/login     │                             │
  │  { username, password }   │                             │
  ├──────────────────────────►│                             │
  │                           │  userExistsLocally()?       │
  │                           │  getent passwd $user        │
  │                           │                             │
  │                           │  YES → verifyPassword.py    │
  │                           │    reads /etc/shadow        │
  │                           │    crypt.crypt(pass, hash)  │
  │                           │    supports yescrypt $y$    │
  │                           │                             │
  │                           │  NO → sshpass SSH to node1  │
  │                           │    ssh user@dilab.ssu.ac.kr │
  │                           │    runs `id` command        │
  │                           │                             │
  │                           │  jwt.sign({                 │
  │                           │    username, isAdmin,       │
  │                           │    groups, uid, exp: 8h     │
  │                           │  })                         │
  │◄──────────────────────────│                             │
  │  { token, user }          │                             │
  │                           │                             │
  │  Zustand + localStorage   │                             │
  │  Authorization: Bearer …  │                             │
```

**isAdmin** is determined by real Linux group membership: `sudo`, `admin`, or `wheel`.

---

## Feature Access & Permission Model

All access control flows through a **single hook** on the frontend and **decorator checks** on the backend. This is the complete matrix:

| Action | Standard User | Admin (sudo group) | Implementation |
|--------|:---:|:---:|---|
| View dashboard / metrics | ✅ | ✅ | `authenticate` hook on all routes |
| View processes | ✅ | ✅ | `authenticate` hook |
| View open ports | ✅ | ✅ | `authenticate` hook |
| View SSH sessions | ✅ | ✅ | `authenticate` hook |
| View storage overview | ✅ | ✅ | `authenticate` hook |
| View per-user storage | ✅ | ✅ | `authenticate` hook |
| View datasets | ✅ | ✅ | `authenticate` hook |
| Kill **own** process | ✅ | ✅ | `proc.user === username` check |
| Kill **other users'** process | ❌ | ✅ | `isAdmin` check in `processRoutes.js` |
| Batch kill zombies | ❌ | ✅ | `requireAdmin` decorator |
| Register dataset | ✅ | ✅ | Authenticated, owner set to caller |
| Edit / delete **own** dataset | ✅ | ✅ | `dataset.owner === username` check |
| Edit / delete **any** dataset | ❌ | ✅ | `isAdmin` check in `datasets/routes.js` |
| Sync dataset | ✅ (own) | ✅ | Owner or admin check |
| Open **own** tmux session | ✅ | ✅ | session name must equal username |
| Attach to **any** tmux session | ❌ | ✅ | `isAdmin` check in `terminalRoutes.js` |
| Create named tmux session | ❌ | ✅ | `isAdmin` check in `terminalRoutes.js` |

### Frontend enforcement — `usePermissions` hook

All UI gating flows through `src/hooks/usePermissions.js`:

```js
import { usePermissions } from '../hooks/usePermissions';

function MyComponent({ process }) {
  const { can } = usePermissions();

  return (
    <>
      {/* Visible to everyone */}
      <ProcessInfo proc={process} />

      {/* Only shown if user owns it OR is admin */}
      {can('kill:own', process.user) && <KillButton proc={process} />}

      {/* Only shown to admins */}
      {can('kill:any') && <ForceKillAllButton />}
    </>
  );
}
```

### Backend enforcement — Fastify decorators

```js
// Require any valid JWT:
fastify.addHook('onRequest', fastify.authenticate);

// Require admin (isAdmin: true in JWT):
fastify.addHook('onRequest', fastify.requireAdmin);

// Require ownership OR admin (in route handler):
if (resource.owner !== request.user.username && !request.user.isAdmin) {
  return reply.status(403).send({ error: 'Forbidden' });
}
```

### Adding a new permission level

To add a "Lab Manager" role (can kill processes but not manage all datasets):

**1. Add the group check in `pamAuth.js`:**
```js
const isLabManager = groupsList.includes('labmanager');
// Add to JWT payload:
return { username, isAdmin, isLabManager, groups, ... };
```

**2. Add to `usePermissions.js`:**
```js
const isLabManager = user?.isLabManager ?? false;

case 'kill:any':
  return isAdmin || isLabManager;  // lab managers can also kill processes
```

**3. Create the Linux group on both servers:**
```bash
sudo groupadd labmanager
sudo usermod -aG labmanager username
```

---

## Adding & Removing Nodes

The node registry is the **single source of truth**. You only ever touch two files.

### Adding a new node

**Step 1 — `backend/src/ssh/sshManager.js`**: add to the `NODES` object:

```js
export const NODES = {
  node1: { ... },
  node2: { ... },

  // ADD THIS:
  node3: {
    id: 'node3',
    label: 'dilab3 (Node 3)',
    host: process.env.NODE3_HOST || 'dilab3.ssu.ac.kr',
    port: parseInt(process.env.NODE3_SSH_PORT || '22'),
    username: process.env.SSH_USER || 'monitor',
    specs: {
      gpus: ['RTX 4090', 'RTX 4090'],
      cores: 32,
      ramGB: 256,
      gpuThermalCritical: false  // set true if post-repair thermal monitoring needed
    }
  }
};
```

**Step 2 — `backend/.env`**: add host variables:

```bash
NODE3_HOST=dilab3.ssu.ac.kr
NODE3_SSH_PORT=22
# No SSH_PASS needed if using key auth (recommended)
```

**Step 3 — Set up the `monitor` user on the new server** (same as dilab node1 setup above).

**Step 4 — Copy SSH public key** to the new server:
```bash
ssh-copy-id -i ~/.ssh/dilab_monitor.pub -p 22 monitor@dilab3.ssu.ac.kr
```

**That's it.** Everything else reads `Object.keys(NODES)` dynamically:
- SSH manager creates connections for all nodes automatically
- Scheduler polls all nodes concurrently
- REST endpoints accept any valid `nodeId` from the registry
- Frontend `NodeCard`, `ThermalPanel`, `StoragePanel` all accept `nodeId` as a prop

**For the frontend**, update `DashboardPage.jsx` to loop over nodes rather than hardcoding:

```jsx
// Instead of hardcoding node1/node2, read from a config:
const NODES = [
  { id: 'node1', label: 'dilab' },
  { id: 'node2', label: 'dilab2', missionCritical: true },
  { id: 'node3', label: 'dilab3' },  // ← add here
];

// Then render dynamically:
{NODES.map(node => (
  <NodeCard key={node.id} nodeId={node.id} nodeData={metrics?.[node.id]} />
))}
```

### Removing a node

**Step 1** — Delete the entry from `NODES` in `sshManager.js`.

**Step 2** — Remove the corresponding `NODE3_HOST` / `NODE3_SSH_PORT` lines from `.env`.

**Step 3** — Remove the node from `DashboardPage.jsx`'s `NODES` array if hardcoded.

Restart the backend — the removed node will no longer appear anywhere in the UI.

### Setting a node as "local" (no SSH)

If you move the backend to a different server, update `.env`:
```bash
# Backend is now on node1:
NODE_LOCAL_ID=node1
```
That node will use `child_process.exec` instead of SSH — no `monitor` user needed on it.

---

## Feature Guide

### Dashboard (`/`)

| Panel | What it shows | Refresh |
|-------|--------------|---------|
| **Alert Banner** | Flashing critical GPU/RAM alerts with post-repair badge for dilab2 | 5s (WS) |
| **Node Cards** | CPU%, RAM%, per-GPU temp/VRAM/util, load avg, mini sparklines | 5s (WS) |
| **Thermal Panels** | Arc gauges per GPU, temp history sparklines, CPU core grid | 5s (WS) |
| **Storage Panels** | Filesystems with NVMe/SATA distinction, usage bars | 5s (WS) |
| **SSH Sessions** | Active sessions per node + recent login history | 15s |
| **Open Ports** | Listening ports with process, PID, user, bind address (requires sudo for full info) | 30s |
| **User Resource Table** | Every researcher's CPU, RAM, VRAM across both nodes | 5s (WS) |

### Processes & GPU (`/processes`)

| Feature | Detail |
|---------|--------|
| Process list | All processes >0.5% CPU/RAM, sorted by VRAM desc |
| VRAM column | Per-process from `nvidia-smi --query-compute-apps` |
| Zombie badge | Skull icon — idle >5min while holding VRAM |
| Kill buttons | Graceful (SIGTERM) / Force (SIGKILL) — two-step confirm |
| Batch zombie kill | Admin-only one-click per node |
| Filters | By node, type (All/GPU/Zombies/Heavy), text search |

### Storage (`/storage`)

| Tab | Detail |
|-----|--------|
| Overview | All filesystems per node, NVMe badge, used/free/total |
| Per-User Usage | `sudo du` ranked list with hover mount breakdown |
| Comparison | Stacked bar chart — both nodes side by side per user |

### Terminal (`/terminal`)

| Feature | Detail |
|---------|--------|
| tmux bridge | xterm.js → WebSocket → SSH PTY → tmux attach |
| Multi-tab | Open multiple sessions simultaneously |
| Node selector | Switch between dilab and dilab2 |
| Session picker | List active sessions, create new ones |
| Permission | Standard users: own session only. Admins: any session |
| Resize | Terminal resizes automatically with the window |

### Dataset Hub (`/datasets`)

| Feature | Detail |
|---------|--------|
| Register | Name, path, node, tags, Markdown README |
| Tag system | 12 pre-seeded tags + user-defined, color-coded |
| Sync | rsync over SSH with SSE progress bar |
| Access | Edit/delete own datasets; admins edit any |

---

## SSH Monitor User Setup

```bash
# On dilab (node1) — create limited monitor account:
sudo useradd -r -m -s /bin/bash monitor

# Allow specific commands without password:
cat << 'EOF' | sudo tee /etc/sudoers.d/dilab-monitor
# System monitoring
monitor ALL=(ALL) NOPASSWD: /usr/bin/sensors
monitor ALL=(ALL) NOPASSWD: /usr/bin/du

# Port monitoring - required for process/user info on all ports
monitor ALL=(ALL) NOPASSWD: /usr/bin/ss
monitor ALL=(ALL) NOPASSWD: /usr/bin/netstat
monitor ALL=(ALL) NOPASSWD: /usr/bin/ps

# Process management
monitor ALL=(ALL) NOPASSWD: /bin/kill
EOF
sudo chmod 440 /etc/sudoers.d/dilab-monitor
```

**Important:** The port monitoring feature requires `ss`, `netstat`, and `ps` with sudo privileges. Without these, the Open Ports display can only show process/user information for ports owned by the monitor user. With sudo configured, all ports will show actual process names and usernames.

---

## Deployment

### Systemd service

```ini
# /etc/systemd/system/dilab-monitor.service
[Unit]
Description=DILab Server Monitor Backend
After=network.target

[Service]
Type=simple
User=oem
WorkingDirectory=/opt/dilab-monitor/backend
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5
EnvironmentFile=/opt/dilab-monitor/backend/.env

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now dilab-monitor
```

### Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name monitor.dilab.ssu.ac.kr;

    # Frontend static build
    location / {
        root /opt/dilab-monitor/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # API
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket (metrics stream + terminal)
    location ~ ^/(ws|api/terminal)/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;   # keep terminal WS alive
    }
}
```

### Frontend build

```bash
cd frontend && npm run build
# Output: frontend/dist/  — serve via nginx.conf
```

---

## Security Notes

1. **Change `JWT_SECRET`** in `.env` to a 64+ character random string before any production use
2. **HTTPS in production** — add TLS via certbot; the terminal WebSocket carries live keystrokes
3. **Network-level access** — bind Nginx to the lab's internal network only, not the public internet
4. **`monitor` user is read-only** — it has no write access to user files; kill operations use `sudo kill` scoped to that binary only
5. **Terminal sessions run as `monitor`** — not as the authenticated web user. For user-isolated terminals, configure tmux to `su` to the user inside the session
6. **Rate limiting** — the built-in limiter is in-memory (resets on restart); for production use `@fastify/rate-limit` with Redis
7. **dilab2 thermal flag** — `gpuThermalCritical: true` on node2 ensures all its GPU alerts carry a `⚠ POST-Repair` label, making them visually distinct from normal warnings
8. **Audit trail** — all kill operations are logged: `[Kill] User oem killed PID 1234 on node2 with SIGTERM`. Pipe to syslog with `LOG_LEVEL=info`

---

## Terminal SSH Setup (per user)

The terminal tab SSHes to `localhost:22` to launch tmux as the actual user.
Each researcher needs their own SSH key authorized on dilab2:

```bash
# Each user runs this on dilab2 (once):
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""    # skip if key exists
cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys

# Test it works:
ssh -o StrictHostKeyChecking=no localhost "echo OK"
```

Alternatively the admin can run a script to set this up for all users:
```bash
for user in $(getent passwd | awk -F: '$3 >= 1000 && $3 < 65534 {print $1}'); do
  home=$(eval echo ~$user)
  sudo mkdir -p $home/.ssh
  sudo -u $user ssh-keygen -t ed25519 -f $home/.ssh/id_ed25519 -N "" 2>/dev/null || true
  sudo bash -c "cat $home/.ssh/id_ed25519.pub >> $home/.ssh/authorized_keys"
  sudo chmod 700 $home/.ssh
  sudo chmod 600 $home/.ssh/authorized_keys
  sudo chown -R $user:$user $home/.ssh
  echo "Done: $user"
done
```

Also ensure `~/.ssh/authorized_keys` for the backend's SSH key is set:
```bash
# In backend .env — point to the user's own key (not the monitor key):
# For local terminal, the backend will try SSH agent first, then this key
SSH_KEY_PATH=/home/oem/.ssh/id_ed25519
```

#### log
```bash
sudo journalctl -u dilab-monitor -f
```

---

## Troubleshooting

### Open Ports showing "unknown" for user/process

**Symptom:** The Open Ports page shows "unknown" in the Process and User columns for most ports.

**Cause:** The monitoring user (or backend user on local node) doesn't have sudo privileges to run `ss`, `ps`, and `netstat`.

**Solution:**

1. **Verify sudo configuration exists:**
   ```bash
   # On dilab2 (as the backend user, e.g., oem):
   sudo -l | grep -E "ss|ps|netstat"

   # On dilab (as monitor user):
   ssh -p 2222 monitor@dilab.ssu.ac.kr "sudo -l | grep -E 'ss|ps|netstat'"
   ```

2. **If missing, add sudo permissions:**
   ```bash
   # On each node, create/update /etc/sudoers.d/dilab-monitor:
   sudo visudo -f /etc/sudoers.d/dilab-monitor

   # Add these lines (replace $USER with actual username):
   <username> ALL=(ALL) NOPASSWD: /usr/bin/ss
   <username> ALL=(ALL) NOPASSWD: /usr/bin/netstat
   <username> ALL=(ALL) NOPASSWD: /usr/bin/ps
   ```

3. **Test sudo commands work without password:**
   ```bash
   sudo -n ss -tlnpH | head -3
   sudo -n ps -o pid=,user= -p 1
   ```

   Should show output, NOT "sudo: a password is required"

4. **Restart backend** (if running as a service):
   ```bash
   sudo systemctl restart dilab-monitor
   ```

**Expected behavior after fix:**
- Process column: Shows actual process names (nginx, sshd, redis-server, etc.)
- PID column: Shows actual process IDs (numbers, not "–")
- User column: Shows actual usernames (root, www-data, username, etc.)

**Fallback behavior without sudo:**
- Only ports owned by the monitoring user will show process/user info
- Ports owned by other users will show "unknown"
- The system still works, just with limited information