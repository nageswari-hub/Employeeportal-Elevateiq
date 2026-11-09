import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { minutesOfDay, weekday } from './time';

export interface AttendanceConfig {
  shiftStart: number; shiftEnd: number; autoCheckout: number; // minutes after local midnight
  graceMinutes: number; halfDayMinutes: number; maxBreakMinutes: number; maxSingleBreakMinutes: number;
}

export interface ReportGateConfig {
  /** When on, the listed roles cannot check out / log out until today's daily report exists. */
  enabled: boolean;
  roles: string[];
}

const ALL_ROLES = ['ADMIN', 'TEAM_LEAD', 'COORDINATOR', 'EMPLOYEE'];
const DEFAULT_GATE_ROLES = ['EMPLOYEE', 'COORDINATOR', 'TEAM_LEAD'];

/** Working days, holidays and the daily report deadline (all editable by admin in Settings). */
@Injectable()
export class WorkCalendarService {
  private cache: { exp: number; workDays: number[]; holidays: Set<string>; deadline: number } | null = null;

  constructor(private prisma: PrismaService) {}

  invalidate() {
    this.cache = null;
    this.attCache = null;
  }

  private attCache: { exp: number; cfg: AttendanceConfig; photo: boolean; gate: ReportGateConfig } | null = null;

  /** Attendance rules (admin-editable in Settings). Safe defaults apply for anything not set. */
  async attendanceConfig(): Promise<AttendanceConfig> {
    return (await this.loadAtt()).cfg;
  }

  async photoRequired(): Promise<boolean> {
    return (await this.loadAtt()).photo;
  }

  /** Daily-report gate: blocks check-out / logout until today's report is submitted. */
  async reportGate(): Promise<ReportGateConfig> {
    return (await this.loadAtt()).gate;
  }

  private async loadAtt() {
    if (this.attCache && this.attCache.exp > Date.now()) return this.attCache;
    const rows = await this.prisma.setting.findMany({ where: { key: { in: ['attendance', 'requireProfilePhoto', 'reportGate'] } } });
    const by = new Map(rows.map((r) => [r.key, r.value as any]));
    const a = (by.get('attendance') ?? {}) as Partial<Record<keyof AttendanceConfig, any>>;
    const rg = (by.get('reportGate') ?? {}) as { enabled?: unknown; roles?: unknown };
    const gateRoles = Array.isArray(rg.roles) ? rg.roles.map(String).filter((r) => ALL_ROLES.includes(r)) : null;
    const toMin = (v: any, d: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? d)) ?? /^(\d{1,2}):(\d{2})$/.exec(d)!; return Number(m[1]) * 60 + Number(m[2]); };
    const num = (v: any, d: number) => (Number.isFinite(Number(v)) && v !== undefined && v !== null ? Number(v) : d);
    this.attCache = {
      exp: Date.now() + 60_000,
      photo: by.get('requireProfilePhoto') !== false,
      gate: { enabled: rg.enabled !== false, roles: gateRoles ?? DEFAULT_GATE_ROLES },
      cfg: {
        shiftStart: toMin(a.shiftStart, '09:30'),
        shiftEnd: toMin(a.shiftEnd, '18:30'),
        autoCheckout: toMin(a.autoCheckout, '23:30'),
        graceMinutes: num(a.graceMinutes, 15),
        halfDayMinutes: num(a.halfDayMinutes, 240),
        maxBreakMinutes: num(a.maxBreakMinutes, 60),
        maxSingleBreakMinutes: num(a.maxSingleBreakMinutes, 45),
      },
    };
    return this.attCache;
  }

  private async load() {
    if (this.cache && this.cache.exp > Date.now()) return this.cache;
    const rows = await this.prisma.setting.findMany({ where: { key: { in: ['workDays', 'holidays', 'reportDeadline'] } } });
    const by = new Map(rows.map((r) => [r.key, r.value as any]));
    const wd = by.get('workDays');
    const hol = by.get('holidays');
    const dl = by.get('reportDeadline');
    const time = String(dl?.time ?? process.env.REPORT_DEADLINE ?? '18:00');
    const m = time.match(/^(\d{1,2}):(\d{2})$/);
    this.cache = {
      exp: Date.now() + 60_000,
      workDays: Array.isArray(wd) && wd.length ? wd.map(Number) : [1, 2, 3, 4, 5, 6],
      holidays: new Set(Array.isArray(hol) ? hol.map(String) : []),
      deadline: m ? Number(m[1]) * 60 + Number(m[2]) : 18 * 60,
    };
    return this.cache;
  }

  async isWorkingDay(day: string): Promise<boolean> {
    const c = await this.load();
    return c.workDays.includes(weekday(day)) && !c.holidays.has(day);
  }

  async deadlineMinutes(): Promise<number> {
    return (await this.load()).deadline;
  }

  /** Raw holiday dates (YYYY-MM-DD) for calendars and exports. */
  async holidaySet(): Promise<Set<string>> {
    return new Set((await this.load()).holidays);
  }

  /** Late = backfilled past day, or today's report after the deadline. */
  async isLate(reportDay: string, today: string, now: Date = new Date()): Promise<boolean> {
    if (reportDay < today) return true;
    if (reportDay > today) return false;
    return minutesOfDay(now) > (await this.deadlineMinutes());
  }
}
