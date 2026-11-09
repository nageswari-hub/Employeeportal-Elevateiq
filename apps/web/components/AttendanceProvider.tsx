'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth-context';
import { TodayState } from '../lib/attendance';

interface Ctx {
  today: TodayState | null;
  err: string;
  errCode: string;
  busy: boolean;
  nowMs: () => number;
  reload: () => Promise<void>;
  checkIn: (mode: 'OFFICE' | 'REMOTE', note?: string) => Promise<boolean>;
  checkOut: (note?: string) => Promise<boolean>;
  startBreak: (reason: string, note?: string) => Promise<boolean>;
  endBreak: () => Promise<boolean>;
  clearErr: () => void;
}
const C = createContext<Ctx | null>(null);

/** One shared copy of "my attendance today" for the header chip, the dashboard banner and the attendance page. */
export function AttendanceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [today, setToday] = useState<TodayState | null>(null);
  const [err, setErr] = useState('');
  const [errCode, setErrCode] = useState('');
  const [busy, setBusy] = useState(false);
  const skew = useRef(0); // server time minus browser time: timers stay right even if the phone clock is wrong

  const apply = useCallback((t: TodayState) => {
    skew.current = new Date(t.serverNow).getTime() - Date.now();
    setToday(t);
  }, []);

  const reload = useCallback(async () => {
    try { apply(await api<TodayState>('/attendance/today')); } catch { /* chip stays hidden if unreachable */ }
  }, [apply]);

  useEffect(() => {
    if (!user) { setToday(null); return; }
    void reload();
    const t = setInterval(() => { if (!document.hidden) void reload(); }, 120_000);
    const vis = () => { if (!document.hidden) void reload(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [user, reload]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(''); setErrCode('');
    try { await fn(); await reload(); return true; }
    catch (e) {
      const ae = e instanceof ApiError ? e : null;
      setErr(ae?.message ?? 'Something went wrong');
      setErrCode(ae?.code ?? '');
      await reload(); return false;
    }
    finally { setBusy(false); }
  }, [reload]);

  const value = useMemo<Ctx>(() => ({
    today, err, errCode, busy, reload,
    nowMs: () => Date.now() + skew.current,
    clearErr: () => { setErr(''); setErrCode(''); },
    checkIn: (mode, note) => run(() => api('/attendance/check-in', { method: 'POST', body: { mode, note: note || undefined } })),
    checkOut: (note) => run(() => api('/attendance/check-out', { method: 'POST', body: { note: note || undefined } })),
    startBreak: (reason, note) => run(() => api('/attendance/break/start', { method: 'POST', body: { reason, note: note || undefined } })),
    endBreak: () => run(() => api('/attendance/break/end', { method: 'POST' })),
  }), [today, err, errCode, busy, reload, run]);

  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useMyAttendance(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error('useMyAttendance must be used inside AttendanceProvider');
  return c;
}

/** Re-render every `ms` milliseconds (for live timers). */
export function useTick(ms = 15_000) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(t); }, [ms]);
}
