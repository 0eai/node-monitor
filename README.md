# DILab Server Monitor

> **Full-stack server management and monitoring platform for the DILab AI Research Lab.**
> Real-time GPU thermals, VRAM zombie detection, per-user resource tracking, and a collaborative dataset hub — across both Ubuntu 22.04 nodes.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Directory Structure](#directory-structure)
3. [Tech Stack](#tech-stack)
4. [Step-by-Step Setup](#step-by-step-setup)
5. [Authentication Flow](#authentication-flow)
6. [Backend Design Decisions](#backend-design-decisions)
7. [Feature Guide](#feature-guide)
8. [SSH Monitor User Setup](#ssh-monitor-user-setup)
9. [Deployment](#deployment)
10. [Security Notes](#security-notes)

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                    Browser (Researcher)                     │
│  React + Vite + Tailwind  ·  Zustand  ·  React Query       │
│  WebSocket (live metrics) ·  REST (datasets, kill, auth)   │
└───────────────────────────┬────────────────────────────────┘
                            │ HTTP / WS
┌───────────────────────────▼────────────────────────────────┐
│              Node.js Backend (Fastify)                      │
│                                                             │
│  /api/auth      ── PAM Linux auth → JWT issuance           │
│  /api/monitoring── Cached snapshots, historical ring buf   │
│  /api/processes ── List, zombie-detect, kill               │
│  /api/datasets  ── CRUD + rsync SSE sync                   │
│  /ws/metrics    ── WebSocket broadcast (5s interval)       │
│                                                             │
│  Scheduler (node-cron, 5s) ──► SSH Manager                 │
│                                    │                        │
└────────────────────────────────────┼───────────────────────┘
                SSH (ssh2)           │
        ┌────────────────────────────┼────────────────────┐
        │                           │                     │
┌───────▼───────┐           ┌───────▼──────────┐
│  dilab (Node 1)│           │  dilab2 (Node 2) │
│  2× RTX 3090  │           │  4× RTX 4090     │
│  18c / 251 GB │           │  40c / 440 GB    │
│               │           │  ⚠ Post-cooling  │
│  nvidia-smi   │           │  repair: thermal │
│  sensors      │           │  priority active │
│  ps aux / top │           │                  │
│  df -h        │           │                  │
└───────────────┘           └──────────────────┘
```

**Data flow for live metrics:**
1. `node-cron` fires every 5 seconds on the backend.
2. The scheduler runs `fetchFullNodeSnapshot()` on both nodes **concurrently** via parallel SSH.
3. Parsed data is stored in `MetricsCache` (in-memory, 30-min ring buffer).
4. The result is broadcast to all connected WebSocket clients.
5. The frontend Zustand store receives the WS message and updates all reactive components atomically.

---

## Directory Structure

```
dilab-monitor/
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── index.js                  # Fastify server, plugin registration
│       ├── auth/
│       │   ├── pamAuth.js            # PAM/system user authentication + userInfo
│       │   └── routes.js             # POST /login, GET /me, POST /refresh
│       ├── monitoring/
│       │   ├── monitoringService.js  # nvidia-smi, sensors, top, df parsers
│       │   ├── routes.js             # GET /all, /node/:id, /alerts, /historical
│       │   ├── processRoutes.js      # GET /list, /zombies; POST /kill, /kill-zombie-batch
│       │   └── scheduler.js         # node-cron 5s polling + MetricsCache + WS broadcast
│       ├── ssh/
│       │   └── sshManager.js        # Connection pool, execOnNode, execOnAllNodes, execStream
│       ├── datasets/
│       │   └── routes.js            # CRUD + rsync SSE sync endpoint
│       └── utils/
│           └── database.js          # better-sqlite3 init, schema migrations, seed tags
│
└── frontend/
    ├── index.html
    ├── vite.config.js
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── package.json
    └── src/
        ├── main.jsx
        ├── App.jsx                   # Router, WS init, QueryClient
        ├── index.css                 # Tailwind + custom CSS vars, animations
        ├── pages/
        │   ├── LoginPage.jsx         # PAM credential form
        │   ├── DashboardPage.jsx     # Main overview: nodes, thermals, storage, users
        │   ├── ProcessesPage.jsx     # Process list, zombie table, kill buttons
        │   └── DatasetsPage.jsx      # Dataset hub: register, tag, sync
        ├── components/
        │   ├── dashboard/
        │   │   └── Layout.jsx        # Sidebar, nav, status pills
        │   └── monitoring/
        │       ├── AlertBanner.jsx   # Flashing critical/warning banner
        │       ├── NodeCard.jsx      # Per-node overview card with mini sparklines
        │       ├── ThermalPanel.jsx  # GPU gauges + sparklines, CPU core temps
        │       ├── StoragePanel.jsx  # Filesystem bars (NVMe vs SATA)
        │       └── UserResourceTable.jsx  # Per-user CPU/RAM/VRAM breakdown
        ├── stores/
        │   ├── authStore.js          # Zustand auth (persisted), login/logout
        │   └── metricsStore.js       # WS client, metrics state, history buffer
        └── utils/
            ├── api.js                # Axios instance, 401 interceptor
            └── format.js            # formatMiB, getThermalColor, relativeTime…
```

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Frontend | React 18 + Vite | Fast HMR, modern React features |
| Styling | Tailwind CSS v3 | Utility-first, dark mode, custom theme |
| Charts | Recharts | Lightweight, composable area/line charts |
| State | Zustand | Minimal boilerplate, persist middleware |
| Data fetching | TanStack Query | Automatic refetch, mutation + cache |
| Real-time | Native WebSocket | Direct push, no Socket.IO overhead |
| Backend | Fastify v4 | High-throughput, schema validation, plugin ecosystem |
| SSH | ssh2 | Mature Node.js SSH client, exec + stream |
| Auth | PAM (authenticate-pam) + JWT | Authentic Linux user auth, stateless API |
| Database | better-sqlite3 | Zero-config, fast, perfect for metadata |
| Scheduler | node-cron | Cron-based polling trigger |

---

## Step-by-Step Setup

### Prerequisites on the server running the backend

```bash
# Ubuntu 22.04
sudo apt install -y libpam-dev build-essential
# For sensor readings on both monitored nodes:
sudo apt install -y lm-sensors
sudo sensors-detect --auto
```

### 1. Clone & configure

```bash
git clone <repo> dilab-monitor && cd dilab-monitor

# Backend
cp backend/.env.example backend/.env
# Edit backend/.env — set JWT_SECRET, SSH_KEY_PATH, etc.
nano backend/.env

# Install
cd backend && npm install
cd ../frontend && npm install
```

### 2. Set up SSH key auth to both nodes

```bash
# On the backend server, as the user running Node.js:
ssh-keygen -t ed25519 -C "dilab-monitor" -f ~/.ssh/dilab_monitor

# Copy to both nodes
ssh-copy-id -i ~/.ssh/dilab_monitor.pub monitor@dilab.ssghu.ac.kr
ssh-copy-id -i ~/.ssh/dilab_monitor.pub monitor@dilab2.ssghu.ac.kr

# In .env:
SSH_KEY_PATH=/home/youruser/.ssh/dilab_monitor
SSH_USER=monitor
```

### 3. Create the `monitor` system user on both nodes

See [SSH Monitor User Setup](#ssh-monitor-user-setup).

### 4. Run development servers

```bash
# Terminal 1 — Backend
cd backend && npm run dev

# Terminal 2 — Frontend
cd frontend && npm run dev
# → http://localhost:5173
```

### 5. Login

Use any valid Linux system account on the server running the backend. Admin access is granted if the user is in the `sudo` or `admin` group.

---

## Authentication Flow

```
Browser                    Fastify Backend              Linux OS
  │                              │                          │
  │  POST /api/auth/login        │                          │
  │  { username, password }      │                          │
  ├─────────────────────────────►│                          │
  │                              │  pamAuth.authenticate()  │
  │                              ├─────────────────────────►│
  │                              │  PAM module validates    │
  │                              │  against /etc/shadow     │
  │                              │  (or LDAP/AD if set up)  │
  │                              │◄─────────────────────────┤
  │                              │                          │
  │                              │  getent passwd $user     │
  │                              │  id $user → groups       │
  │                              │  isAdmin = sudo ∈ groups │
  │                              │                          │
  │                              │  jwt.sign({              │
  │                              │    username, isAdmin,    │
  │                              │    groups, uid           │
  │                              │  }, expiresIn: 8h)       │
  │                              │                          │
  │◄─────────────────────────────┤                          │
  │  { token, user }             │                          │
  │                              │                          │
  │  Store token in Zustand      │                          │
  │  (persisted to localStorage) │                          │
  │                              │                          │
  │  All subsequent requests:    │                          │
  │  Authorization: Bearer <tok> │                          │
```

**Key security properties:**
- Passwords are never stored anywhere — PAM validates against the real system
- JWT contains `isAdmin` flag derived from real Linux group membership (`sudo`/`admin`/`wheel`)
- Admins can kill any process; standard users can only kill their own
- Failed logins trigger a 500ms random delay + in-memory rate limiting (10 attempts / 15 min per IP)
- JWTs expire in 8 hours; auto-refresh is available

---

## Backend Design Decisions

### SSH Connection Pool (`sshManager.js`)

Persistent SSH connections are maintained per node with **exponential backoff reconnection** (1s → 2s → 4s … capped at 30s). This avoids the latency of establishing a new SSH session on every 5-second poll. A keepalive ping fires every 15 seconds to prevent idle timeouts.

```
execOnNode(nodeId, cmd)      — single node, returns stdout string
execOnAllNodes(cmd)          — both nodes concurrently, returns { node1, node2 }
execStreamOnNode(nodeId, cmd, onData, onError)  — streaming (rsync)
```

### Metrics Parsing Strategy

All monitoring data is fetched with a **single composite shell command** per domain (system metrics, GPU, storage) rather than multiple round-trips, dramatically reducing SSH latency per poll cycle:

```bash
# One SSH call fetches CPU%, load avg, RAM, swap, uptime, core count:
echo "=CPU_USAGE=" && top -bn1 | grep "Cpu(s)" | ...
echo "=MEM=" && free -m | ...
echo "=UPTIME=" && uptime -p
```

### Zombie Process Detection

Zombie processes are tracked using a **rolling counter per `(nodeId, pid)` pair**:

```
gpuUtilHistory: Map<"node1-1234", zeroUtilCount>

Every poll cycle:
  if process holds VRAM AND gpuUtil === 0:
    zeroUtilCount++
    if zeroUtilCount >= 60 (≈ 5 min at 5s intervals):
      isZombie = true
  else:
    delete from history  ← clears if process resumes or exits
```

PIDs that no longer appear in `ps aux` are cleaned up automatically via `cleanupZombieHistory()`.

### Dataset Sync (rsync over SSH)

The sync endpoint uses **Server-Sent Events (SSE)** to stream rsync progress:

```
POST /api/datasets/:id/sync
→ Content-Type: text/event-stream

data: {"type":"start","message":"Starting rsync..."}
data: {"type":"progress","pct":24,"speed":"125MB/s","eta":"0:02:14"}
data: {"type":"output","text":"sending incremental file list"}
data: {"type":"complete","totalBytes":8589934592}
```

The frontend renders a live progress bar by consuming the SSE stream via `fetch()` + `ReadableStream`.

---

## Feature Guide

### Dashboard (`/`)

| Panel | What it shows |
|-------|--------------|
| **Node Cards** | CPU%, RAM%, per-GPU: temp, VRAM%, util%, power draw. Mini sparklines (last 5 min) |
| **Alert Banner** | Flashing red cards for critical GPU temps or >95% RAM. Mission-critical flag for dilab2 post-cooling repair |
| **Thermal Panel** | Arc gauge per GPU with temp history sparkline, fan %, wattage. CPU core grid |
| **Storage Panel** | All mounted filesystems with NVMe/SATA distinction, usage bars |
| **User Table** | Every researcher's current CPU, RAM, VRAM footprint across both nodes |

### Processes & GPU (`/processes`)

| Feature | Detail |
|---------|--------|
| **Process list** | All processes using >0.5% CPU or RAM, sorted by VRAM desc |
| **VRAM column** | Per-process VRAM from `nvidia-smi --query-compute-apps` |
| **Zombie badge** | Red skull icon on processes idle >5 min while holding VRAM |
| **Kill button** | Graceful (SIGTERM) or force (SIGKILL). Two-step confirm. Admins kill anything; users kill only their own |
| **Batch zombie kill** | Admin-only one-click kill of all zombies on a given node |
| **Filters** | By node, by type (All/GPU/Zombies/Heavy), by text search |

### Dataset Hub (`/datasets`)

| Feature | Detail |
|---------|--------|
| **Register** | Name, absolute path, node, Markdown description, tags |
| **Tag system** | 12 pre-seeded tags + user-defined. Color-coded badges. Click to filter |
| **Markdown README** | Collapsible in-card preview with GFM support |
| **Sync** | Click → modal → rsync SSE stream with live progress bar |
| **Access control** | Edit/delete own datasets; admins can edit any |

---

## SSH Monitor User Setup

Create a limited `monitor` account on both nodes with just enough permissions:

```bash
# On dilab and dilab2:
sudo useradd -r -s /bin/bash -m monitor

# Allow nvidia-smi (world-readable, no sudo needed)
# Allow sensors (may need sudo on some setups):
echo "monitor ALL=(ALL) NOPASSWD: /usr/bin/sensors" | sudo tee /etc/sudoers.d/monitor-sensors

# Allow kill for zombie cleanup (admin backend operations go via root SSH key instead):
# For per-user kills, users SSH as themselves — the backend re-issues kill over their SSH session.
# For admin batch kill, the monitor user needs:
echo "monitor ALL=(ALL) NOPASSWD: /bin/kill" | sudo tee -a /etc/sudoers.d/monitor-sensors

sudo chmod 440 /etc/sudoers.d/monitor-sensors
```

> **Note:** For the admin kill feature to work cross-user, the backend can alternatively SSH as root (with a hardened key) for kill operations only, keeping `monitor` read-only for metrics.

---

## Deployment

### Systemd service (backend)

```ini
# /etc/systemd/system/dilab-monitor.service
[Unit]
Description=DILab Server Monitor Backend
After=network.target

[Service]
Type=simple
User=monitor
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
    server_name monitor.dilab.ssghu.ac.kr;

    # Frontend (static build)
    location / {
        root /opt/dilab-monitor/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # API + WebSocket
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Frontend build

```bash
cd frontend && npm run build
# Outputs to frontend/dist/ — serve via Nginx above
```

---

## Security Notes

1. **Change `JWT_SECRET`** in `.env` to a cryptographically random 64+ char string before deployment.
2. **Never run the backend as root.** The `monitor` user + targeted sudoers is the right model.
3. **HTTPS in production.** Add a TLS cert (Let's Encrypt via certbot) to the Nginx config.
4. **Network-level access control.** Consider binding Nginx to the lab's internal network only (`listen 10.x.x.x:443`) so the dashboard is not internet-facing.
5. **Rate limiting.** The built-in IP rate limiter is in-memory and resets on restart. For production, add `@fastify/rate-limit` backed by Redis.
6. **Audit trail.** All kill operations are logged via `fastify.log.info(...)`. Pipe logs to a file or syslog with `LOG_LEVEL=info`.
7. **dilab2 thermal monitoring**: Given the recent cooling system repair, the `gpuThermalCritical: true` flag on Node 2 causes all thermal alerts from that node to include a `⚠ POST-REPAIR` label, making them immediately distinguishable in the alert banner and thermal panel.
