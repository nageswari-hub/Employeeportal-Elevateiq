import type { AttendanceConfig } from '../../common/work-calendar.service';
import { minutesOfDay } from '../../common/time';

export type DayState = 'WORKING' | 'ON_BREAK' | 'CHECKED_OUT' | 'LEAVE' | 'NOT_IN' | 'ABSENT' | 'OFF';
export type StoredStatus = 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE';

export interface BreakSpan { startAt: Date; endAt: Date | null }

const MIN = 60_000;

/** Minutes of break that fall inside [from, to]. Open breaks run until `now`. */
export function breakMinutes(breaks: BreakSpan[], from: Date, to: Date, now: Date): number {
  let total = 0;
  for (const b of breaks) {
    const s = Math.max(b.startAt.getTime(), from.getTime());
    const e = Math.min((b.endAt ?? now).getTime(), to.getTime());
    if (e > s) total += e - s;
  }
  return Math.floor(total / MIN);
}

/** Working time = time between check-in and (check-out | now) minus breaks. Never negative. */
export function workedAndBreak(checkIn: Date, checkOut: Date | null, breaks: BreakSpan[], now: Date) {
  const end = checkOut ?? now;
  const gross = Math.max(0, Math.floor((end.getTime() - checkIn.getTime()) / MIN));
  const br = Math.min(gross, breakMinutes(breaks, checkIn, end, now));
  return { worked: gross - br, breaks: br };
}

/** How many minutes after shift start the person arrived (0 inside the grace window). */
export function lateMinutes(checkIn: Date, cfg: AttendanceConfig): number {
  const m = minutesOfDay(checkIn);
  return m > cfg.shiftStart + cfg.graceMinutes ? m - cfg.shiftStart : 0;
}

/** Stored status. Half-day only applies once the day is finished (checked out), never to someone still working. */
export function statusFor(late: number, finished: boolean, worked: number, cfg: AttendanceConfig): StoredStatus {
  if (finished && worked < cfg.halfDayMinutes) return 'HALF_DAY';
  return late > 0 ? 'LATE' : 'PRESENT';
}

export function stateFor(rec: { status: StoredStatus; checkInAt: Date | null; checkOutAt: Date | null } | null, hasOpenBreak: boolean, isToday: boolean, workingDay: boolean): DayState {
  if (rec?.status === 'ON_LEAVE') return 'LEAVE';
  if (rec?.checkInAt) return rec.checkOutAt ? 'CHECKED_OUT' : hasOpenBreak ? 'ON_BREAK' : 'WORKING';
  if (!workingDay) return 'OFF';
  return isToday ? 'NOT_IN' : 'ABSENT';
}

/** One-letter codes for the Excel day-grid. */
export const GRID_CODE: Record<DayState | 'LATE' | 'HALF', string> = {
  WORKING: 'P', ON_BREAK: 'P', CHECKED_OUT: 'P', LATE: 'L', HALF: 'H', LEAVE: 'LV', NOT_IN: 'A', ABSENT: 'A', OFF: '-',
};

export function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
