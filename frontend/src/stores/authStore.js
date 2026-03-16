import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../utils/api';

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (username, password) => {
        set({ isLoading: true, error: null });
        try {
          const { data } = await api.post('/auth/login', { username, password });
          api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
          set({
            user: data.user,
            token: data.token,
            isAuthenticated: true,
            isLoading: false,
            error: null
          });
          return true;
        } catch (err) {
          set({
            error: err.response?.data?.message || 'Login failed',
            isLoading: false,
            isAuthenticated: false
          });
          return false;
        }
      },

      logout: () => {
        delete api.defaults.headers.common['Authorization'];
        set({ user: null, token: null, isAuthenticated: false, error: null });
      },

      refreshToken: async () => {
        const { token } = get();
        if (!token) return;
        try {
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
          const { data } = await api.post('/auth/refresh');
          api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`;
          set({ token: data.token });
        } catch {
          get().logout();
        }
      },

      // Restore auth header from persisted token on app start
      hydrate: () => {
        const { token } = get();
        if (token) {
          api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        }
      }
    }),
    {
      name: 'dilab-auth',
      partialize: (state) => ({ user: state.user, token: state.token, isAuthenticated: state.isAuthenticated })
    }
  )
);
