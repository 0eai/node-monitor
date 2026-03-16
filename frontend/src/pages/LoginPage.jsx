import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Server, Lock, User, AlertCircle, Cpu } from 'lucide-react';

export default function LoginPage() {
  const { login, isAuthenticated, isLoading, error } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    await login(username, password);
  };

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4"
      style={{
        backgroundImage: `
          radial-gradient(ellipse 60% 50% at 50% 0%, rgba(56,189,248,0.06) 0%, transparent 70%),
          radial-gradient(ellipse 40% 30% at 80% 80%, rgba(99,102,241,0.04) 0%, transparent 60%)
        `
      }}>

      {/* Grid texture */}
      <div className="absolute inset-0 opacity-[0.02]"
        style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="w-full max-w-sm relative z-10 animate-fade-up">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 mb-4 shadow-glow-accent">
            <Cpu size={26} className="text-accent" />
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-100">DILab Monitor</h1>
          <p className="text-slate-500 text-sm mt-1">Sign in with your Linux system account</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                Username
              </label>
              <div className="relative">
                <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="your-linux-username"
                  autoComplete="username"
                  autoFocus
                  className="w-full bg-surface-900 border border-white/8 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200
                             placeholder:text-slate-600 focus:outline-none focus:border-accent/50 focus:bg-surface-900
                             transition-colors font-mono"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="w-full bg-surface-900 border border-white/8 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200
                             placeholder:text-slate-600 focus:outline-none focus:border-accent/50
                             transition-colors"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger animate-slide-in">
                <AlertCircle size={15} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-lg bg-accent text-surface-900 font-semibold text-sm
                         hover:bg-accent/90 active:scale-[0.98] transition-all duration-150
                         disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-surface-900/40 border-t-surface-900 rounded-full animate-spin" />
                  Authenticating…
                </>
              ) : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Node status footer */}
        <div className="mt-4 flex items-center justify-center gap-4 text-xs text-slate-600">
          <div className="flex items-center gap-1.5">
            <Server size={11} />
            <span>dilab.ssghu.ac.kr</span>
          </div>
          <span>·</span>
          <div className="flex items-center gap-1.5">
            <Server size={11} />
            <span>dilab2.ssghu.ac.kr</span>
          </div>
        </div>
        <p className="text-center text-xs text-slate-700 mt-2">
          Authenticated via Linux PAM · Access mirrors system privileges
        </p>
      </div>
    </div>
  );
}
