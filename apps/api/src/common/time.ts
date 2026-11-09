// Timezone helpers. One place decides "what day is it" for the whole app.
export const APP_TZ = process.env.APP_TZ || process.env.TZ || 'Asia/Kolkata';

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** YYYY-MM-DD of an instant in the app timezone. */
export function dayStr(d: Date = new Date()): string {
  return dayFmt.format(d);
}

/** Minutes since local midnight in the app timezone. */
export function minutesOfDay(d: Date = new Date()): number {
  const [h, m] = clockFmt.format(d).split(':').map(Number);
  return h * 60 + m;
}

export function isValidDay(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  // Round-trip check: JS silently rolls 2026-02-30 over to March 2, so parse success alone is not enough.
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Value for @db.Date columns: UTC midnight of the calendar day. */
export function dayToDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function addDays(day: string, n: number): string {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday, for a calendar day. */
export function weekday(day: string): number {
  return dayToDate(day).getUTCDay();
}

export function offsetMs(at: Date, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(at.getTime() / 1000) * 1000;
}

/** [start, end) UTC instants of a local calendar day (DST-safe). */
export function dayRange(day: string, tz: string = APP_TZ): { start: Date; end: Date } {
  const edge = (d: string) => {
    const utcMid = Date.parse(`${d}T00:00:00Z`);
    const first = utcMid - offsetMs(new Date(utcMid), tz);
    return new Date(utcMid - offsetMs(new Date(first), tz));
  };
  return { start: edge(day), end: edge(addDays(day, 1)) };
}

/** Parse a user-supplied day or throw-safe return null. */
export function parseDay(s: unknown): string | null {
  return isValidDay(s) ? s : null;
}

/** Shifts an instant so its UTC fields read as the company-timezone wall clock (what Excel should display). */
export function tzShift(d: Date): Date {
  return new Date(d.getTime() + offsetMs(d, APP_TZ));
}

/** Local HH:MM on a calendar day -> the real instant (DST-safe via dayRange). */
export function localTimeToInstant(day: string, hhmm: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error('bad time');
  return new Date(dayRange(day).start.getTime() + (Number(m[1]) * 60 + Number(m[2])) * 60_000);
}

export function monthRange(month: string): { from: string; to: string } | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const from = `${month}-01`;
  const d = dayToDate(from);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return { from, to: d.toISOString().slice(0, 10) };
}
