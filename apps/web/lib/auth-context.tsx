'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, SessionUser } from './api';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const Ctx = createContext<AuthState>({ user: null, loading: true, login: async () => {}, logout: async () => {}, reload: async () => {} });

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const reload = useCallback(async () => {
    try {
      const me = await api<SessionUser>('/auth/me');
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const login = useCallback(async (email: string, password: string) => {
    await api('/auth/login', { method: 'POST', body: { email, password } });
    const me = await api<SessionUser>('/auth/me');
    setUser(me);
    router.replace(me.mustChangePassword ? '/change-password' : '/dashboard');
  }, [router]);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch (e) {
      // The daily-report gate: still signed in, but today's report must be written first.
      if (e instanceof ApiError && e.code === 'REPORT_REQUIRED') {
        router.replace('/reports?gate=1');
        return;
      }
      /* any other failure (expired session, offline): log out locally anyway */
    }
    setUser(null);
    router.replace('/login');
  }, [router]);

  return <Ctx.Provider value={{ user, loading, login, logout, reload }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  return useContext(Ctx);
}

export function useRequireAuth(roles?: SessionUser['role'][]) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [photoRequired, setPhotoRequired] = useState<boolean | undefined>(undefined);
  // roles arrives as an inline array literal at call sites (new identity every
  // render). Key the effect on its contents, otherwise every render re-fires
  // the effect and any future navigating condition becomes an infinite loop.
  const roleKey = (roles ?? []).join(',');
  useEffect(() => {
    if (!user || user.avatarFileId) return;
    api<{ key: string; value: unknown }[]>('/settings').then((rows) => setPhotoRequired(rows.find((r) => r.key === 'requireProfilePhoto')?.value !== false)).catch(() => setPhotoRequired(true));
  }, [user]);
  useEffect(() => {
    if (loading) return;
    if (user && !user.avatarFileId && photoRequired === undefined) return; // wait for the setting before deciding
    if (!user) {
      router.replace('/login');
      return;
    }
    if (user.mustChangePassword) {
      router.replace('/change-password');
      return;
    }
    if (roles && !roles.includes(user.role) && user.role !== 'ADMIN') router.replace('/dashboard');
    // NOTE: no forced redirect for missing photos (it trapped new users on one
    // page and felt like the app was broken). PhotoBanner in Shell reminds
    // instead; the server still requires a photo at check-in time.
  }, [user, loading, roleKey, router, photoRequired]); // eslint-disable-line react-hooks/exhaustive-deps
  return { user, loading };
}
