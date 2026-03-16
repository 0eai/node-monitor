import { create } from 'zustand';
import api from '../utils/api';

export const useMetricsStore = create((set, get) => ({
  metrics: null,
  alerts: [],
  history: { node1: [], node2: [] },
  connectionStatus: {},
  wsConnected: false,
  lastUpdated: null,
  isLoading: true,
  error: null,
  ws: null,

  fetchMetrics: async () => {
    try {
      const { data } = await api.get('/monitoring/all');
      const alerts = [
        ...(data.node1?.alerts || []),
        ...(data.node2?.alerts || [])
      ];
      set({
        metrics: data,
        alerts,
        lastUpdated: new Date(),
        isLoading: false,
        error: null
      });
    } catch (err) {
      set({ error: err.message, isLoading: false });
    }
  },

  fetchHistory: async (nodeId) => {
    try {
      const { data } = await api.get(`/monitoring/historical/${nodeId}?limit=60`);
      set(state => ({
        history: { ...state.history, [nodeId]: data }
      }));
    } catch {}
  },

  connectWebSocket: (token) => {
    const { ws } = get();
    if (ws) ws.close();

    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/metrics?token=${token}`;
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      set({ wsConnected: true });
      console.log('[WS] Connected to metrics stream');
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'metrics_update') {
          const alerts = [
            ...(msg.data.node1?.alerts || []),
            ...(msg.data.node2?.alerts || [])
          ];
          set({
            metrics: msg.data,
            alerts,
            lastUpdated: new Date(),
            isLoading: false,
            error: null
          });

          // Update history ring buffer in memory
          const { history } = get();
          for (const nodeId of ['node1', 'node2']) {
            const snap = msg.data[nodeId];
            if (snap && !snap.error) {
              const entry = {
                timestamp: snap.timestamp,
                cpuUsagePct: snap.system?.cpuUsagePct,
                memUsedPct: snap.system?.memUsedPct,
                gpuTemps: snap.gpu?.gpus?.map(g => g.tempC),
                gpuUtils: snap.gpu?.gpus?.map(g => g.utilizationGpuPct),
                gpuMemPcts: snap.gpu?.gpus?.map(g => g.memUsedPct)
              };
              const nodeHistory = [...(history[nodeId] || []), entry].slice(-60);
              set(state => ({ history: { ...state.history, [nodeId]: nodeHistory } }));
            }
          }
        }
      } catch {}
    };

    socket.onclose = () => {
      set({ wsConnected: false });
      // Auto-reconnect after 3s
      setTimeout(() => {
        const currentToken = token;
        if (currentToken) get().connectWebSocket(currentToken);
      }, 3000);
    };

    socket.onerror = () => {
      set({ wsConnected: false });
    };

    set({ ws: socket });
  },

  disconnectWebSocket: () => {
    const { ws } = get();
    if (ws) { ws.close(); set({ ws: null, wsConnected: false }); }
  }
}));
