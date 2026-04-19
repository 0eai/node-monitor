/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      gridTemplateColumns: {
        '20': 'repeat(20, minmax(0, 1fr))',
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif']
      },
      colors: {
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          900: '#0f1117',
          800: '#161b27',
          750: '#1a2133',
          700: '#1e2a3d',
          600: '#243347',
          500: '#2d3f57'
        },
        accent: {
          DEFAULT: '#38bdf8',
          dim: '#0ea5e9',
          glow: 'rgba(56,189,248,0.15)'
        },
        danger: { DEFAULT: '#f43f5e', dim: '#be123c', glow: 'rgba(244,63,94,0.2)' },
        warn: { DEFAULT: '#f59e0b', dim: '#d97706', glow: 'rgba(245,158,11,0.2)' },
        success: { DEFAULT: '#10b981', dim: '#059669' },
        gpu: {
          normal: '#10b981',
          warm: '#f59e0b',
          hot: '#f97316',
          critical: '#f43f5e'
        }
      },
      animation: {
        'pulse-fast': 'pulse 0.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'flicker': 'flicker 1.5s step-end infinite',
        'slide-in': 'slideIn 0.3s ease-out',
        'fade-up': 'fadeUp 0.4s ease-out'
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' }
        },
        slideIn: {
          from: { transform: 'translateX(-10px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' }
        },
        fadeUp: {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' }
        }
      },
      boxShadow: {
        'glow-accent': '0 0 20px rgba(56,189,248,0.15), 0 0 40px rgba(56,189,248,0.05)',
        'glow-danger': '0 0 20px rgba(244,63,94,0.25), 0 0 40px rgba(244,63,94,0.1)',
        'glow-warn': '0 0 20px rgba(245,158,11,0.2)',
        'card': '0 1px 3px rgba(0,0,0,0.3), 0 4px 12px rgba(0,0,0,0.2)'
      }
    }
  },
  plugins: []
};
