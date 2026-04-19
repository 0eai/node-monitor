import { useEffect, useRef, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../stores/authStore';
import { usePermissions } from '../hooks/usePermissions';
import api from '../utils/api';
import {
  Terminal as TerminalIcon, Plus, RefreshCw,
  Server, ChevronDown, Circle, X, Maximize2, Minimize2
} from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

// ─── Lazy-load xterm to avoid SSR issues ──────────────────────────────────────
let Terminal, FitAddon, WebLinksAddon;
async function loadXterm() {
  if (Terminal) return;
  const [xterm, fit, links] = await Promise.all([
    import('@xterm/xterm'),
    import('@xterm/addon-fit'),
    import('@xterm/addon-web-links')
  ]);
  Terminal = xterm.Terminal;
  FitAddon = fit.FitAddon;
  WebLinksAddon = links.WebLinksAddon;
}

// ─── Single Terminal Instance ─────────────────────────────────────────────────
function TerminalPane({ nodeId, sessionName, token, onClose }) {
  const containerRef = useRef(null);
  const termRef = useRef(null);
  const wsRef = useRef(null);
  const fitRef = useRef(null);
  const [status, setStatus] = useState('connecting'); // connecting | connected | disconnected | error
  const [errorMsg, setErrorMsg] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const connect = useCallback(async () => {
    if (!containerRef.current) return;
    setStatus('connecting');

    await loadXterm();

    // Clean up existing terminal
    if (termRef.current) { termRef.current.dispose(); termRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }

    // Init xterm
    const term = new Terminal({
      theme: {
        background: '#0f1117',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        cursorAccent: '#0f1117',
        selectionBackground: 'rgba(56,189,248,0.3)',
        black: '#1e2a3d',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#38bdf8',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#e2e8f0',
        brightBlack: '#334155',
        brightRed: '#fb7185',
        brightGreen: '#34d399',
        brightYellow: '#fcd34d',
        brightBlue: '#7dd3fc',
        brightMagenta: '#a78bfa',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc'
      },
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: true,
      scrollSensitivity: 1,
      fastScrollSensitivity: 5,
      scrollOnUserInput: true,
      altClickMovesCursor: false
    });

    const fitAddon = new FitAddon();
    const linksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(linksAddon);
    term.open(containerRef.current);
    // Delay fit until after the DOM has rendered and element has dimensions
    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 100);
    termRef.current = term;
    fitRef.current = fitAddon;

    // WebSocket connection
    const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // In production (Nginx): connects to same host/port, Nginx proxies to backend
    // In dev: connects directly to backend port (Vite cannot proxy WS on /api paths)
    const isDev = import.meta.env.DEV;
    const backendPort = import.meta.env.VITE_BACKEND_PORT || '3001';
    const wsHost = isDev
      ? `${window.location.hostname}:${backendPort}`
      : window.location.host;
    const wsUrl = `${wsProtocol}://${wsHost}/api/terminal/attach?token=${token}&nodeId=${nodeId}&sessionName=${encodeURIComponent(sessionName)}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      // Send initial terminal size
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            setStatus('connected');
            term.writeln(`\x1b[32m✓ Connected to tmux session: \x1b[1m${msg.sessionName}\x1b[0m`);
            term.writeln(`\x1b[90mNode: ${msg.nodeId} | Type 'exit' to detach\x1b[0m\r\n`);
            return;
          }
          if (msg.type === 'error') {
            setStatus('error');
            setErrorMsg(msg.message);
            term.writeln(`\r\n\x1b[31m✗ SSH Error: ${msg.message}\x1b[0m`);
            if (msg.detail) term.writeln(`\x1b[33m  Detail: ${msg.detail}\x1b[0m`);
            if (msg.hint)   term.writeln(`\x1b[36m  Fix:    ${msg.hint}\x1b[0m`);
            term.writeln(`\x1b[90m  Check backend logs for more info.\x1b[0m`);
            return;
          }
          if (msg.type === 'log') {
            term.writeln(`\x1b[90m[debug] ${msg.message}\x1b[0m`);
            return;
          }
        } catch {}
        term.write(event.data);
      } else {
        // Binary data
        term.write(new Uint8Array(event.data));
      }
    };

    ws.onerror = (e) => {
      console.error('[Terminal WS error]', e);
      setStatus('error');
      setErrorMsg('WebSocket connection failed — check backend is running');
      term.writeln(`\r\n\x1b[31m✗ WebSocket error — backend may be down\x1b[0m`);
    };



    ws.onclose = (event) => {
      setStatus('disconnected');
      if (termRef.current) {
        term.writeln(`\r\n\x1b[33m⚡ Session disconnected (code ${event.code})\x1b[0m`);
      }
    };

    // Terminal input → WebSocket
    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle terminal resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitRef.current && containerRef.current?.offsetWidth > 0) {
        try {
          fitRef.current.fit();
          const dims = fitRef.current.proposeDimensions();
          if (dims && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
          }
        } catch {}
      }
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    term.focus();

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [nodeId, sessionName, token]);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup?.then(fn => fn?.());
      if (wsRef.current) wsRef.current.close();
      if (termRef.current) termRef.current.dispose();
    };
  }, [connect]);

  // Fullscreen effect
  useEffect(() => {
    if (fitRef.current) setTimeout(() => fitRef.current?.fit(), 100);
  }, [isFullscreen]);

  const statusColor = {
    connecting: 'text-warn',
    connected: 'text-success',
    disconnected: 'text-slate-500',
    error: 'text-danger'
  }[status];

  const statusDot = {
    connecting: 'bg-warn animate-pulse',
    connected: 'bg-success',
    disconnected: 'bg-slate-600',
    error: 'bg-danger animate-ping-slow'
  }[status];

  return (
    <div className={`flex flex-col rounded-xl border border-white/8 bg-[#0f1117]
      ${isFullscreen ? 'fixed inset-4 z-50 shadow-2xl' : 'h-[520px]'}`}
    >
      {/* Terminal toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-surface-800 border-b border-white/8 flex-shrink-0">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot}`} />
        <span className="text-xs font-mono text-slate-300 flex-1">
          {nodeId === 'node1' ? 'dilab' : 'dilab2'} — tmux: <span className="text-accent">{sessionName}</span>
        </span>
        <span className={`text-[10px] font-medium ${statusColor}`}>{status}</span>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={() => setIsFullscreen(f => !f)}
            className="p-1 text-slate-600 hover:text-slate-300 rounded transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          {status === 'disconnected' || status === 'error' ? (
            <button onClick={connect} className="p-1 text-slate-600 hover:text-accent rounded transition-colors" title="Reconnect">
              <RefreshCw size={13} />
            </button>
          ) : null}
          {onClose && (
            <button onClick={onClose} className="p-1 text-slate-600 hover:text-danger rounded transition-colors">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* xterm container */}
      <div
        ref={containerRef}
        className="flex-1 p-1 overflow-auto"
        style={{ minHeight: 0 }}
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}

// ─── Session Selector ──────────────────────────────────────────────────────────
function SessionSelector({ nodeId, onSelect, currentSession, user }) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');

  const { data } = useQuery({
    queryKey: ['tmux-sessions', nodeId],
    queryFn: () => api.get(`/terminal/sessions/${nodeId}`).then(r => r.data),
    refetchInterval: 10000
  });

  const sessions = data?.sessions || [];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-700 border border-white/8
                   text-xs text-slate-300 hover:border-accent/30 transition-colors"
      >
        <Circle size={8} className={sessions.find(s => s.name === currentSession)?.attached ? 'text-success fill-success' : 'text-slate-600'} />
        <span className="font-mono">{currentSession}</span>
        <ChevronDown size={11} className="text-slate-500" />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-surface-800 border border-white/8 rounded-xl shadow-2xl z-20 overflow-hidden">
          {sessions.length > 0 && (
            <>
              <div className="px-3 py-1.5 text-[10px] text-slate-600 uppercase tracking-wider border-b border-white/5">
                Active sessions
              </div>
              {sessions.map(s => (
                <button key={s.name}
                  onClick={() => { onSelect(s.name); setOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-white/5 text-left"
                >
                  <Circle size={7} className={s.attached ? 'text-success fill-success' : 'text-slate-600'} />
                  <span className="font-mono flex-1">{s.name}</span>
                  {s.attached && <span className="text-[9px] text-success">attached</span>}
                  {s.isOwn && <span className="text-[9px] text-accent">yours</span>}
                </button>
              ))}
              <div className="border-t border-white/5" />
            </>
          )}

          {/* Create new session */}
          <div className="p-2">
            <div className="text-[10px] text-slate-600 uppercase tracking-wider mb-1.5 px-1">New session</div>
            <div className="flex gap-1">
              <input
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && newName.trim()) {
                    onSelect(newName.trim());
                    setOpen(false);
                    setNewName('');
                  }
                }}
                placeholder={user.username}
                className="flex-1 bg-surface-900 border border-white/8 rounded px-2 py-1 text-xs font-mono
                           text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent/50"
              />
              <button
                onClick={() => {
                  if (newName.trim()) { onSelect(newName.trim()); setOpen(false); setNewName(''); }
                  else { onSelect(user.username); setOpen(false); }
                }}
                className="px-2 py-1 bg-accent/15 text-accent text-xs rounded border border-accent/25 hover:bg-accent/25"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Terminal Page ────────────────────────────────────────────────────────
export default function TerminalPage() {
  const { user, token } = useAuthStore();
  const { can } = usePermissions();
  const [tabs, setTabs] = useState([
    { id: 1, nodeId: 'node2', sessionName: user?.username || 'main' }
  ]);
  const [activeTab, setActiveTab] = useState(1);
  const nextId = useRef(2);

  const addTab = (nodeId = 'node2') => {
    const id = nextId.current++;
    setTabs(t => [...t, { id, nodeId, sessionName: user?.username || 'main' }]);
    setActiveTab(id);
  };

  const closeTab = (id) => {
    setTabs(t => {
      const remaining = t.filter(tab => tab.id !== id);
      if (activeTab === id && remaining.length > 0) {
        setActiveTab(remaining[remaining.length - 1].id);
      }
      return remaining;
    });
  };

  const updateTab = (id, updates) => {
    setTabs(t => t.map(tab => tab.id === id ? { ...tab, ...updates } : tab));
  };

  const activeTabData = tabs.find(t => t.id === activeTab);

  return (
    <div className="p-6 space-y-4 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="font-display text-xl font-semibold text-slate-100 flex items-center gap-2">
            <TerminalIcon size={20} className="text-accent" />
            Terminal
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            tmux sessions via SSH · {user?.isAdmin ? 'Admin — access to all sessions' : `Your session: ${user?.username}`}
          </p>
        </div>

        {/* Install hint */}
        <div className="text-xs text-slate-600 bg-surface-800 border border-white/5 rounded-lg px-3 py-2 font-mono">
          Requires: <span className="text-slate-400">tmux</span> on both nodes
          <div className="text-[10px] mt-0.5">sudo apt install tmux</div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="flex gap-1 bg-surface-800 border border-white/5 rounded-xl p-1 flex-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex-shrink-0
                ${activeTab === tab.id
                  ? 'bg-accent/15 text-accent border border-accent/20'
                  : 'text-slate-500 hover:text-slate-300'
                }`}
            >
              <Server size={11} />
              <span className="font-mono">{tab.nodeId === 'node1' ? 'dilab' : 'dilab2'}</span>
              <span className="text-slate-600">/</span>
              <span className="font-mono">{tab.sessionName}</span>
              {tabs.length > 1 && (
                <span
                  onClick={e => { e.stopPropagation(); closeTab(tab.id); }}
                  className="ml-1 text-slate-600 hover:text-danger cursor-pointer"
                >
                  <X size={10} />
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Add tab button */}
        <div className="flex gap-1 flex-shrink-0">
          <button onClick={() => addTab('node2')} className="btn-ghost text-xs flex-shrink-0">
            <Plus size={12} /> dilab2
          </button>
          <button onClick={() => addTab('node1')} className="btn-ghost text-xs flex-shrink-0">
            <Plus size={12} /> dilab
          </button>
        </div>
      </div>

      {/* Session & Node controls for active tab */}
      {activeTabData && (
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-slate-500">Node:</span>
          <div className="flex rounded-lg overflow-hidden border border-white/8">
            {['node1', 'node2'].map(n => (
              <button key={n}
                onClick={() => updateTab(activeTab, { nodeId: n })}
                className={`px-3 py-1.5 text-xs transition-colors
                  ${activeTabData.nodeId === n ? 'bg-accent/15 text-accent' : 'text-slate-500 hover:text-slate-300'}`}
              >
                {n === 'node1' ? 'dilab' : 'dilab2'}
              </button>
            ))}
          </div>

          <span className="text-xs text-slate-500">Session:</span>
          <SessionSelector
            nodeId={activeTabData.nodeId}
            currentSession={activeTabData.sessionName}
            onSelect={name => updateTab(activeTab, { sessionName: name })}
            user={user}
          />

          <span className="text-xs text-slate-600 ml-auto font-mono">
            {can('terminal:any') ? '🔑 Admin — can attach to any session' : `🔒 Limited to your session (${user?.username})`}
          </span>
        </div>
      )}

      {/* Terminals — render all but only show active */}
      <div className="flex-1 min-h-0">
        {tabs.map(tab => (
          <div key={tab.id} className={tab.id === activeTab ? 'h-full' : 'hidden'}>
            <TerminalPane
              nodeId={tab.nodeId}
              sessionName={tab.sessionName}
              token={token}
              onClose={tabs.length > 1 ? () => closeTab(tab.id) : undefined}
            />
          </div>
        ))}
      </div>

      {/* Permission note */}
      {!user?.isAdmin && (
        <div className="text-xs text-slate-600 flex-shrink-0 text-center">
          Standard users can only access their own tmux session.
          Contact an admin to gain access to other sessions.
        </div>
      )}
    </div>
  );
}