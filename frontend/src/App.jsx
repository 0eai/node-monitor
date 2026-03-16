import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './stores/authStore';
import { useMetricsStore } from './stores/metricsStore';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ProcessesPage from './pages/ProcessesPage';
import DatasetsPage from './pages/DatasetsPage';
import Layout from './components/dashboard/Layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 }
  }
});

function ProtectedRoute({ children }) {
  const isAuthenticated = useAuthStore(s => s.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { hydrate, isAuthenticated, token } = useAuthStore();
  const { connectWebSocket, disconnectWebSocket, fetchMetrics } = useMetricsStore();

  useEffect(() => {
    hydrate();
  }, []);

  useEffect(() => {
    if (isAuthenticated && token) {
      fetchMetrics();
      connectWebSocket(token);
    } else {
      disconnectWebSocket();
    }
    return () => { if (!isAuthenticated) disconnectWebSocket(); };
  }, [isAuthenticated, token]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }>
            <Route index element={<DashboardPage />} />
            <Route path="processes" element={<ProcessesPage />} />
            <Route path="datasets" element={<DatasetsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#1e2a3d',
            color: '#e2e8f0',
            border: '1px solid rgba(255,255,255,0.08)',
            fontFamily: '"DM Sans", sans-serif',
            fontSize: '14px'
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#0f1117' } },
          error: { iconTheme: { primary: '#f43f5e', secondary: '#0f1117' } }
        }}
      />
    </QueryClientProvider>
  );
}
