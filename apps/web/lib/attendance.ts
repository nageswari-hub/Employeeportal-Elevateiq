export type DayState = 'WORKING' | 'ON_BREAK' | 'CHECKED_OUT' | 'LEAVE' | 'NOT_IN' | 'ABSENT' | 'OFF';

export interface BreakItem { id?: string; reason: string; note: string | null; startAt: string; endAt: string | null }
export interface MyRecord {
  id: string; status: 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE'; mode: string; checkInAt: string | null; checkOutAt: string | null;
  lateMinutes: number; note: string | null; autoClosed: boolean; workedMinutes: number; breakMinutes: number; breaks: BreakItem[]; openBreak: BreakItem | null;
}
export interface TodayState {
  day: string; serverNow: string; workingDay: boolean; photoMissing: boolean;
  config: { shiftStart: number; shiftEnd: number; graceMinutes: number; maxBreakMinutes: number; maxSingleBreakMinutes: number };
  /** Daily-report gate: when required and not submitted, check-out / logout are blocked. */
  reportGate?: { required: boolean; submitted: boolean };
  record: MyRecord | null;
}

export const BREAK_LABEL: Record<string, string> = { LUNCH: 'Lunch', TEA: 'Tea / coffee', PERSONAL: 'Personal', OTHER: 'Other' };
export const BREAK_EMOJI: Record<string, string> = { LUNCH: '🍽️', TEA: '☕', PERSONAL: '🚶', OTHER: '💬' };

export const STATE_LABEL: Record<DayState, string> = {
  WORKING: 'Working', ON_BREAK: 'On break', CHECKED_OUT: 'Checked out', LEAVE: 'On leave', NOT_IN: 'Not in yet', ABSENT: 'Absent', OFF: 'Day off',
};
export const STATE_PILL: Record<DayState, string> = {
  WORKING: 'bg-green-50 text-green-700', ON_BREAK: 'bg-amber-50 text-amber-700', CHECKED_OUT: 'bg-slate-100 text-slate-600',
  LEAVE: 'bg-sky-50 text-sky-700', NOT_IN: 'bg-orange-50 text-orange-700', ABSENT: 'bg-red-50 text-red-700', OFF: 'bg-slate-50 text-slate-400',
};
export const STATE_RING: Record<DayState, 'online' | 'break' | 'out' | undefined> = {
  WORKING: 'online', ON_BREAK: 'break', CHECKED_OUT: 'out', LEAVE: undefined, NOT_IN: undefined, ABSENT: undefined, OFF: undefined,
};

export function fmtDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';

export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Worked / break minutes right now, computed in the browser so timers move without asking the server. */
export function liveMinutes(r: MyRecord | null, nowMs: number): { worked: number; brk: number } {
  if (!r?.checkInAt) return { worked: 0, brk: 0 };
  const start = new Date(r.checkInAt).getTime();
  const end = r.checkOutAt ? new Date(r.checkOutAt).getTime() : nowMs;
  let brk = 0;
  for (const b of r.breaks) {
    const s = Math.max(new Date(b.startAt).getTime(), start);
    const e = Math.min(b.endAt ? new Date(b.endAt).getTime() : nowMs, end);
    if (e > s) brk += e - s;
  }
  const gross = Math.max(0, end - start);
  return { worked: Math.floor(Math.max(0, gross - brk) / 60000), brk: Math.floor(brk / 60000) };
}

export const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}`;
};
