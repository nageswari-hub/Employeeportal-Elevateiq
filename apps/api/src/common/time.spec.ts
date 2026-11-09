import { addDays, dayRange, isValidDay, weekday } from './time';
import { tempPassword } from '../modules/users/users.service';

describe('time helpers', () => {
  it('validates calendar days strictly', () => {
    expect(isValidDay('2026-10-03')).toBe(true);
    expect(isValidDay('2026-02-30')).toBe(false);
    expect(isValidDay('03/10/2026')).toBe(false);
    expect(isValidDay(undefined)).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('knows the weekday', () => {
    expect(weekday('2026-10-04')).toBe(0); // Sunday
    expect(weekday('2026-10-05')).toBe(1); // Monday
  });

  it('computes timezone-correct day boundaries', () => {
    const { start, end } = dayRange('2026-10-03', 'Asia/Kolkata');
    expect(start.toISOString()).toBe('2026-10-02T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-10-03T18:30:00.000Z');
  });

  it('handles DST days (23h / 25h) without drifting', () => {
    const spring = dayRange('2026-03-08', 'America/New_York');
    expect((spring.end.getTime() - spring.start.getTime()) / 3600_000).toBe(23);
    const fall = dayRange('2026-11-01', 'America/New_York');
    expect((fall.end.getTime() - fall.start.getTime()) / 3600_000).toBe(25);
  });

  it('dayStr / minutesOfDay follow the configured app timezone', () => {
    jest.resetModules();
    process.env.APP_TZ = 'Asia/Kolkata';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const t = require('./time');
    const instant = new Date('2026-10-03T20:00:00Z'); // 01:30 on the 4th in Kolkata
    expect(t.dayStr(instant)).toBe('2026-10-04');
    expect(t.minutesOfDay(instant)).toBe(90);
    expect(t.dayToDate('2026-10-03').toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });
});

describe('temporary passwords', () => {
  it('always satisfy the letter+number policy and are unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const p = tempPassword();
      expect(p).toHaveLength(10);
      expect(/[A-Za-z]/.test(p) && /\d/.test(p)).toBe(true);
      expect(/[0OIl1]/.test(p.replace(/1/g, ''))).toBe(false); // no look-alikes (0,O,I,l)
      seen.add(p);
    }
    expect(seen.size).toBe(500);
  });
});
