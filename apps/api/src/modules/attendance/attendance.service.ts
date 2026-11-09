import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { WorkCalendarService, AttendanceConfig } from '../../common/work-calendar.service';
import { UserCacheService } from '../../common/user-cache.service';
import { addDays, dayRange, dayStr, dayToDate, isValidDay, localTimeToInstant, minutesOfDay, monthRange, tzShift, weekday } from '../../common/time';
import { buildXlsx, Cell, Sheet, XLSX_MIME } from '../../common/xlsx';
import { NotificationsService } from '../comms/notifications.service';
import { RealtimeGateway } from '../comms/realtime.gateway';
import { ReportGateService } from '../../common/report-gate.service';
import { CheckInDto, CheckOutDto, MarkAttendanceDto, StartBreakDto } from './attendance.dto';
import { DayState, fmtMinutes, GRID_CODE, lateMinutes, StoredStatus, stateFor, statusFor, workedAndBreak } from './attendance.logic';

const BREAK_LABEL: Record<string, string> = { LUNCH: 'Lunch', TEA: 'Tea / coffee', PERSONAL: 'Personal', OTHER: 'Other' };
const STATE_LABEL: Record<DayState, string> = {
  WORKING: 'Working', ON_BREAK: 'On break', CHECKED_OUT: 'Checked out', LEAVE: 'On leave', NOT_IN: 'Not checked in', ABSENT: 'Absent', OFF: 'Day off',
};
const MAX_BREAKS_PER_DAY = 15;

export interface Row {
  userId: string; name: string; email: string; role: string; teamId: string | null; teamName: string | null; batchName: string | null;
  day: string; state: DayState; status: StoredStatus | null; late: boolean; halfDay: boolean;
  mode: string | null; checkInAt: Date | null; checkOutAt: Date | null; lateMinutes: number;
  workedMinutes: number; breakMinutes: number; breakCount: number; overBreak: boolean;
  onBreakSince: Date | null; breakReason: string | null; autoClosed: boolean; edited: boolean; note: string | null;
  breaks: Array<{ reason: string; note: string | null; startAt: Date; endAt: Date | null; minutes: number }>;
}

type UserLite = {
  id: string; displayName: string; email: string; role: string; teamId: string | null; batchId: string | null;
  isActive: boolean; deactivatedAt: Date | null; createdAt: Date; team: { name: string } | null; batch: { name: string } | null;
};
const USER_SELECT = {
  id: true, displayName: true, email: true, role: true, teamId: true, batchId: true, isActive: true, deactivatedAt: true, createdAt: true,
  team: { select: { name: true } }, batch: { select: { name: true } },
} as const;

@Injectable()
export class AttendanceService {
  private memo = new Map<string, { exp: number; v: any }>();

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private calendar: WorkCalendarService,
    private cache: UserCacheService,
    private notifications: NotificationsService,
    private realtime: RealtimeGateway,
    private reportGate: ReportGateService,
  ) {}

  // =====================================================================
  //  My day: check-in, breaks, check-out
  // =====================================================================
  private shapeRecord(rec: any, now: Date) {
    if (!rec) return null;
    const breaks = (rec.breaks ?? []) as Array<{ id: string; reason: string; note: string | null; startAt: Date; endAt: Date | null }>;
    const open = breaks.find((b) => !b.endAt) ?? null;
    const live = rec.checkInAt ? workedAndBreak(rec.checkInAt, rec.checkOutAt, breaks, now) : { worked: 0, breaks: 0 };
    return {
      id: rec.id, status: rec.status as StoredStatus, mode: rec.mode, checkInAt: rec.checkInAt, checkOutAt: rec.checkOutAt,
      lateMinutes: rec.lateMinutes, note: rec.note, autoClosed: rec.autoClosed, workedMinutes: live.worked, breakMinutes: live.breaks,
      breaks: breaks.map((b) => ({ id: b.id, reason: b.reason, note: b.note, startAt: b.startAt, endAt: b.endAt })), openBreak: open,
    };
  }

  async today(me: RequestUser) {
    const now = new Date();
    const day = dayStr(now);
    const [rec, cfg, working, photo] = await Promise.all([
      this.prisma.attendanceDay.findUnique({ where: { userId_day: { userId: me.id, day: dayToDate(day) } }, include: { breaks: { orderBy: { startAt: 'asc' } } } }),
      this.calendar.attendanceConfig(),
      this.calendar.isWorkingDay(day),
      this.calendar.photoRequired(),
    ]);
    const u = await this.prisma.user.findUnique({ where: { id: me.id }, select: { avatarFileId: true } });
    return {
      day, serverNow: now.toISOString(), workingDay: working,
      photoMissing: photo && !u?.avatarFileId,
      config: { shiftStart: cfg.shiftStart, shiftEnd: cfg.shiftEnd, graceMinutes: cfg.graceMinutes, maxBreakMinutes: cfg.maxBreakMinutes, maxSingleBreakMinutes: cfg.maxSingleBreakMinutes },
      reportGate: await this.reportGate.status(me.id, me.role),
      record: this.shapeRecord(rec, now),
    };
  }

  private changed(userId: string, teamId: string | null) {
    this.memo.clear();
    this.realtime.emitAttendance(teamId, userId);
  }

  async checkIn(me: RequestUser, dto: CheckInDto, ip?: string) {
    if (await this.calendar.photoRequired()) {
      const u = await this.prisma.user.findUnique({ where: { id: me.id }, select: { avatarFileId: true } });
      if (!u?.avatarFileId) throw new BadRequestException('Add your profile photo first (Profile page), then check in.');
    }
    const now = new Date();
    const day = dayStr(now);
    const cfg = await this.calendar.attendanceConfig();
    const where = { userId_day: { userId: me.id, day: dayToDate(day) } };
    const existing = await this.prisma.attendanceDay.findUnique({ where });
    if (existing?.status === 'ON_LEAVE' && !existing.checkInAt) throw new ConflictException('You are marked on leave today. Ask your team lead if this is wrong.');
    if (existing?.checkInAt) throw new ConflictException(`You already checked in at ${tzShift(existing.checkInAt).toISOString().slice(11, 16)}.`);
    const late = lateMinutes(now, cfg);
    try {
      const rec = await this.prisma.attendanceDay.create({
        data: {
          userId: me.id, day: dayToDate(day), teamId: me.teamId ?? null, batchId: me.batchId ?? null,
          status: statusFor(late, false, 0, cfg), mode: dto.mode ?? 'OFFICE', checkInAt: now, lateMinutes: late,
          note: dto.note?.trim() || null, checkInIp: ip ?? null,
        },
        include: { breaks: true },
      });
      this.changed(me.id, me.teamId ?? null);
      return this.shapeRecord(rec, now);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('You already checked in today.'); // double-click race
      throw e;
    }
  }

  private async mustOpenRecord(me: RequestUser) {
    const now = new Date();
    const rec = await this.prisma.attendanceDay.findUnique({
      where: { userId_day: { userId: me.id, day: dayToDate(dayStr(now)) } }, include: { breaks: { orderBy: { startAt: 'asc' } } },
    });
    if (!rec?.checkInAt) throw new BadRequestException('Check in first.');
    if (rec.checkOutAt) throw new BadRequestException('You already checked out today. Ask your lead if you need it reopened.');
    return { rec, now };
  }

  async startBreak(me: RequestUser, dto: StartBreakDto) {
    const { rec, now } = await this.mustOpenRecord(me);
    if (rec.breaks.some((b) => !b.endAt)) throw new ConflictException('You are already on a break.');
    if (rec.breaks.length >= MAX_BREAKS_PER_DAY) throw new BadRequestException('Too many breaks today. Talk to your lead.');
    if (dto.reason === 'OTHER' && (dto.note ?? '').trim().length < 3) throw new BadRequestException('Please say why (a few words) for an "Other" break.');
    await this.prisma.breakLog.create({ data: { attendanceId: rec.id, userId: me.id, reason: dto.reason, note: dto.note?.trim() || null, startAt: now } });
    this.changed(me.id, me.teamId ?? null);
    return this.today(me);
  }

  async endBreak(me: RequestUser) {
    const { rec, now } = await this.mustOpenRecord(me);
    const open = rec.breaks.find((b) => !b.endAt);
    if (!open) throw new BadRequestException('You are not on a break.');
    await this.prisma.$transaction(async (tx) => {
      await tx.breakLog.update({ where: { id: open.id }, data: { endAt: now } });
      const all = rec.breaks.map((b) => (b.id === open.id ? { ...b, endAt: now } : b));
      await tx.attendanceDay.update({ where: { id: rec.id }, data: { breakMinutes: workedAndBreak(rec.checkInAt!, null, all, now).breaks } });
    });
    this.changed(me.id, me.teamId ?? null);
    return this.today(me);
  }

  async checkOut(me: RequestUser, dto: CheckOutDto) {
    const { rec, now } = await this.mustOpenRecord(me);
    await this.reportGate.assert(me.id, me.role, 'CHECK_OUT');
    await this.closeRecord(rec, now, { note: dto.note?.trim() || null, auto: false });
    this.changed(me.id, me.teamId ?? null);
    return this.today(me);
  }

  /** Ends any open break, stamps check-out, recomputes totals and the final status. */
  private async closeRecord(rec: any, at: Date, o: { note?: string | null; auto: boolean }) {
    const cfg = await this.calendar.attendanceConfig();
    const breaks = (rec.breaks as any[]).map((b) => (b.endAt ? b : { ...b, endAt: at }));
    const { worked, breaks: br } = workedAndBreak(rec.checkInAt, at, breaks, at);
    await this.prisma.$transaction(async (tx) => {
      await tx.breakLog.updateMany({ where: { attendanceId: rec.id, endAt: null }, data: { endAt: at, autoEnded: o.auto } });
      await tx.attendanceDay.update({
        where: { id: rec.id },
        data: { checkOutAt: at, workedMinutes: worked, breakMinutes: br, status: statusFor(rec.lateMinutes, true, worked, cfg), checkOutNote: o.note ?? null, autoClosed: o.auto },
      });
    });
  }

  // =====================================================================
  //  Scoping & row computation
  // =====================================================================
  private scopeWhere(me: RequestUser, f: { teamId?: string; batchId?: string; userId?: string }) {
    const where: any = {};
    if (me.role === 'ADMIN') {
      if (f.teamId) where.teamId = f.teamId === 'none' ? null : f.teamId;
    } else if (me.role === 'TEAM_LEAD' || me.role === 'COORDINATOR') {
      where.teamId = me.teamId ?? '__none__'; // staff see their own team only; ?teamId= cannot widen it
    } else {
      where.id = me.id; // employees: themselves only
    }
    if (f.batchId) where.batchId = f.batchId;
    if (f.userId) where.id = f.userId;
    return where;
  }

  private async assertCanSee(me: RequestUser, userId: string) {
    if (me.id === userId || me.role === 'ADMIN') return;
    if (me.role === 'EMPLOYEE') throw new ForbiddenException('You can only see your own attendance');
    const t = await this.prisma.user.findUnique({ where: { id: userId }, select: { teamId: true } });
    if (!t) throw new NotFoundException('User not found');
    if (!me.teamId || t.teamId !== me.teamId) throw new ForbiddenException('That person is not in your team');
  }

  private async compute(users: UserLite[], from: string, to: string): Promise<{ rows: Row[]; days: string[]; working: Map<string, boolean> }> {
    const now = new Date();
    const today = dayStr(now);
    const cfg = await this.calendar.attendanceConfig();
    const last = to > today ? today : to;
    const days: string[] = [];
    for (let d = from, i = 0; d <= last && i < 400; d = addDays(d, 1), i++) days.push(d);
    const working = new Map<string, boolean>();
    for (const d of days) working.set(d, await this.calendar.isWorkingDay(d));
    if (!days.length || !users.length) return { rows: [], days, working };

    const recs = await this.prisma.attendanceDay.findMany({
      where: { userId: { in: users.map((u) => u.id) }, day: { gte: dayToDate(from), lte: dayToDate(last) } },
      include: { breaks: { orderBy: { startAt: 'asc' } } },
    });
    const byKey = new Map(recs.map((r) => [`${r.userId}|${r.day.toISOString().slice(0, 10)}`, r]));
    const rows: Row[] = [];
    for (const d of days) {
      for (const u of users) {
        const rec = byKey.get(`${u.id}|${d}`);
        const eligible = dayStr(u.createdAt) <= d && (u.isActive || (u.deactivatedAt != null && dayStr(u.deactivatedAt) >= d));
        if (!rec && (!eligible || u.role === 'ADMIN')) continue; // admins are not marked absent; others only while they were on the roster
        const breaks = rec?.breaks ?? [];
        const open = breaks.find((b) => !b.endAt) ?? null;
        const live = rec?.checkInAt ? workedAndBreak(rec.checkInAt, rec.checkOutAt, breaks, now) : { worked: 0, breaks: 0 };
        const state = stateFor(rec as any, Boolean(open), d === today, working.get(d) ?? true);
        rows.push({
          userId: u.id, name: u.displayName, email: u.email, role: u.role, teamId: u.teamId, teamName: u.team?.name ?? null, batchName: u.batch?.name ?? null,
          day: d, state, status: (rec?.status as StoredStatus) ?? null,
          late: (rec?.lateMinutes ?? 0) > 0 && state !== 'LEAVE', halfDay: rec?.status === 'HALF_DAY',
          mode: rec?.mode ?? null, checkInAt: rec?.checkInAt ?? null, checkOutAt: rec?.checkOutAt ?? null, lateMinutes: rec?.lateMinutes ?? 0,
          workedMinutes: live.worked, breakMinutes: live.breaks, breakCount: breaks.length, overBreak: live.breaks > cfg.maxBreakMinutes,
          onBreakSince: open?.startAt ?? null, breakReason: open?.reason ?? null, autoClosed: rec?.autoClosed ?? false,
          edited: Boolean(rec?.editedById), note: rec?.note ?? null,
          breaks: breaks.map((b) => ({ reason: b.reason, note: b.note, startAt: b.startAt, endAt: b.endAt, minutes: Math.floor(((b.endAt ?? now).getTime() - b.startAt.getTime()) / 60_000) })),
        });
      }
    }
    return { rows, days, working };
  }

  private summarize(rows: Row[]) {
    const c = { total: rows.length, present: 0, onTime: 0, late: 0, halfDay: 0, working: 0, onBreak: 0, checkedOut: 0, leave: 0, notIn: 0, absent: 0, off: 0, overBreak: 0, workedMinutes: 0, breakMinutes: 0 };
    for (const r of rows) {
      if (r.state === 'OFF') { c.off++; if (!r.checkInAt) continue; }
      if (r.state === 'LEAVE') c.leave++;
      else if (r.state === 'NOT_IN') c.notIn++;
      else if (r.state === 'ABSENT') c.absent++;
      else if (r.checkInAt) {
        c.present++;
        if (r.halfDay) c.halfDay++;
        else if (r.late) c.late++;
        else c.onTime++;
        if (r.state === 'WORKING') c.working++;
        if (r.state === 'ON_BREAK') c.onBreak++;
        if (r.state === 'CHECKED_OUT') c.checkedOut++;
        c.workedMinutes += r.workedMinutes;
        c.breakMinutes += r.breakMinutes;
        if (r.overBreak) c.overBreak++;
      }
    }
    return c;
  }

  private async scopedUsers(me: RequestUser, f: { teamId?: string; batchId?: string; userId?: string }, from: string): Promise<UserLite[]> {
    const where = this.scopeWhere(me, f);
    return (await this.prisma.user.findMany({
      where: { ...where, OR: [{ isActive: true }, { deactivatedAt: { gte: dayRange(from).start } }] },
      select: USER_SELECT, orderBy: [{ displayName: 'asc' }],
    })) as unknown as UserLite[];
  }

  // =====================================================================
  //  Live board (admin / lead / coordinator)
  // =====================================================================
  async board(me: RequestUser, q: { date?: string; teamId?: string; batchId?: string }) {
    if (me.role === 'EMPLOYEE') throw new ForbiddenException('Forbidden');
    const date = q.date ?? dayStr();
    if (!isValidDay(date)) throw new BadRequestException('date must be YYYY-MM-DD');
    if (date > dayStr()) throw new BadRequestException('Cannot view a future date');
    const key = `${me.role}|${me.teamId}|${date}|${q.teamId ?? ''}|${q.batchId ?? ''}`;
    const hit = this.memo.get(key);
    if (hit && hit.exp > Date.now()) return hit.v;

    const users = await this.scopedUsers(me, q, date);
    const { rows, working } = await this.compute(users, date, date);
    const order: Record<DayState, number> = { ON_BREAK: 0, WORKING: 1, CHECKED_OUT: 2, LEAVE: 3, NOT_IN: 4, ABSENT: 5, OFF: 6 };
    rows.sort((a, b) => order[a.state] - order[b.state] || a.name.localeCompare(b.name));
    const cfg = await this.calendar.attendanceConfig();
    const result = {
      date, workingDay: working.get(date) ?? true, serverNow: new Date().toISOString(),
      config: { shiftStart: cfg.shiftStart, shiftEnd: cfg.shiftEnd, maxBreakMinutes: cfg.maxBreakMinutes },
      summary: this.summarize(rows), rows,
    };
    this.memo.set(key, { exp: Date.now() + 3000, v: result });
    if (this.memo.size > 100) this.memo.clear();
    return result;
  }

  // =====================================================================
  //  Month / person views
  // =====================================================================
  private rangeFrom(q: { month?: string; from?: string; to?: string }): { from: string; to: string } {
    if (q.from || q.to) {
      if (!q.from || !q.to || !isValidDay(q.from) || !isValidDay(q.to)) throw new BadRequestException('from and to must be YYYY-MM-DD');
      if (q.to < q.from) throw new BadRequestException('to must be after from');
      if (q.to > addDays(q.from, 366)) throw new BadRequestException('Range is limited to one year');
      return { from: q.from, to: q.to };
    }
    const m = q.month ?? dayStr().slice(0, 7);
    const r = monthRange(m);
    if (!r) throw new BadRequestException('month must be YYYY-MM');
    return r;
  }

  private personSummary(rows: Row[], working: Map<string, boolean>) {
    const s = { workingDays: 0, present: 0, onTime: 0, late: 0, halfDay: 0, leave: 0, absent: 0, notIn: 0, workedMinutes: 0, breakMinutes: 0, attendancePct: 0, avgWorkedMinutes: 0 };
    for (const r of rows) {
      if (r.state === 'OFF' && !r.checkInAt) continue;
      if (r.state !== 'OFF' || r.checkInAt) s.workingDays += working.get(r.day) ? 1 : 0;
      if (r.state === 'LEAVE') s.leave++;
      else if (r.state === 'ABSENT') s.absent++;
      else if (r.state === 'NOT_IN') s.notIn++;
      else if (r.checkInAt) {
        s.present++;
        if (r.halfDay) s.halfDay++; else if (r.late) s.late++; else s.onTime++;
        s.workedMinutes += r.workedMinutes; s.breakMinutes += r.breakMinutes;
      }
    }
    const denom = Math.max(1, s.workingDays - s.leave);
    s.attendancePct = Math.round(((s.present - s.halfDay * 0.5) / denom) * 1000) / 10;
    s.avgWorkedMinutes = s.present ? Math.round(s.workedMinutes / s.present) : 0;
    return s;
  }

  async person(me: RequestUser, userId: string, q: { month?: string; from?: string; to?: string }) {
    await this.assertCanSee(me, userId);
    const { from, to } = this.rangeFrom(q);
    const user = (await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT })) as unknown as UserLite | null;
    if (!user) throw new NotFoundException('User not found');
    const { rows, days, working } = await this.compute([user], from, to);
    // every calendar day, even those with no row (future days / day-off for admins) so a calendar can be drawn
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const today = dayStr();
    const full: Array<Row | { day: string; state: 'FUTURE' | 'OFF' }> = [];
    for (let d = from; d <= to; d = addDays(d, 1)) full.push(byDay.get(d) ?? { day: d, state: d > today ? 'FUTURE' : 'OFF' });
    return { user: { id: user.id, name: user.displayName, email: user.email, team: user.team?.name ?? null }, from, to, summary: this.personSummary(rows, working), days: full, workingDays: days.filter((d) => working.get(d)).length };
  }

  mine(me: RequestUser, q: { month?: string }) {
    return this.person(me, me.id, { month: q.month });
  }

  // =====================================================================
  //  Corrections by admin / team lead
  // =====================================================================
  async mark(me: RequestUser, dto: MarkAttendanceDto, ip?: string) {
    if (me.role !== 'ADMIN' && me.role !== 'TEAM_LEAD') throw new ForbiddenException('Only admin or team lead can correct attendance');
    if (!isValidDay(dto.day)) throw new BadRequestException('Invalid day');
    const today = dayStr();
    if (dto.day > today) throw new BadRequestException('Cannot mark a future day');
    if (dto.day < addDays(today, -62)) throw new BadRequestException('Records older than about two months cannot be edited');
    await this.assertCanSee(me, dto.userId);
    const target = await this.prisma.user.findUnique({ where: { id: dto.userId }, select: { id: true, teamId: true, batchId: true, displayName: true } });
    if (!target) throw new NotFoundException('User not found');
    if (target.id === me.id && me.role !== 'ADMIN') throw new ForbiddenException('Ask an admin to correct your own attendance');

    const cfg = await this.calendar.attendanceConfig();
    const where = { userId_day: { userId: dto.userId, day: dayToDate(dto.day) } };
    const existing = await this.prisma.attendanceDay.findUnique({ where, include: { breaks: true } });
    const now = new Date();

    let data: any;
    if (dto.status === 'ON_LEAVE') {
      data = { status: 'ON_LEAVE', checkInAt: null, checkOutAt: null, lateMinutes: 0, workedMinutes: 0, breakMinutes: 0 };
    } else {
      const inAt = dto.checkIn ? localTimeToInstant(dto.day, dto.checkIn) : existing?.checkInAt ?? null;
      let outAt = dto.checkOut ? localTimeToInstant(dto.day, dto.checkOut) : existing?.checkOutAt ?? null;
      if (!inAt) throw new BadRequestException('Provide a check-in time');
      if (outAt && outAt <= inAt) throw new BadRequestException('Check-out must be after check-in');
      if (!outAt && dto.day < today) outAt = localTimeToInstant(dto.day, `${Math.floor(cfg.shiftEnd / 60)}:${String(cfg.shiftEnd % 60).padStart(2, '0')}`);
      const late = lateMinutes(inAt, cfg);
      const m = workedAndBreak(inAt, outAt, existing?.breaks ?? [], now);
      const status = dto.status ?? statusFor(late, Boolean(outAt), m.worked, cfg);
      data = { status, checkInAt: inAt, checkOutAt: outAt, lateMinutes: late, workedMinutes: outAt ? m.worked : 0, breakMinutes: m.breaks, mode: dto.mode ?? existing?.mode ?? 'OFFICE', autoClosed: false };
    }
    data.editedById = me.id;
    data.editReason = dto.reason.trim();
    const rec = existing
      ? await this.prisma.attendanceDay.update({ where: { id: existing.id }, data })
      : await this.prisma.attendanceDay.create({ data: { userId: dto.userId, day: dayToDate(dto.day), teamId: target.teamId, batchId: target.batchId, ...data } });
    await this.audit.log({ actorId: me.id, action: 'ATTENDANCE_EDIT', entity: 'attendance', entityId: rec.id, metadata: { user: target.displayName, day: dto.day, reason: dto.reason, status: rec.status }, ip });
    if (target.id !== me.id) {
      await this.notifications.notify([target.id], { type: 'ATTENDANCE', title: `Your attendance for ${dto.day} was updated`, body: `${me.displayName}: ${dto.reason.trim()}`, link: '/attendance' });
    }
    this.changed(target.id, target.teamId);
    return { ok: true, id: rec.id, status: rec.status };
  }

  // =====================================================================
  //  Exports (Excel / CSV)
  // =====================================================================
  private hours(m: number): number {
    return Math.round((m / 60) * 100) / 100;
  }
  private t(d: Date | null): Cell {
    return d ? { v: tzShift(d) as any, style: 'time' } : '';
  }
  private stateText(r: Row): string {
    if (r.state === 'CHECKED_OUT' || r.state === 'WORKING' || r.state === 'ON_BREAK') {
      return r.halfDay ? 'Half day' : r.late ? 'Late' : 'Present';
    }
    return STATE_LABEL[r.state];
  }
  private stateCell(r: Row): Cell {
    const text = this.stateText(r);
    const style = text === 'Present' ? 'good' : text === 'Late' || text === 'Half day' ? 'warn' : text === 'Absent' || text === 'Not checked in' ? 'bad' : 'muted';
    return { v: text, style };
  }

  private dailySheet(rows: Row[], title: string): Sheet {
    return {
      name: 'Daily', title,
      columns: [{ header: '#', width: 5 }, { header: 'Name', width: 26 }, { header: 'Email', width: 30 }, { header: 'Role', width: 14 }, { header: 'Team', width: 18 }, { header: 'Batch', width: 18 },
        { header: 'Status', width: 16 }, { header: 'Check-in', width: 10 }, { header: 'Check-out', width: 10 }, { header: 'Late (min)', width: 10 }, { header: 'Worked (hrs)', width: 12 },
        { header: 'Break (min)', width: 11 }, { header: 'Breaks', width: 8 }, { header: 'Mode', width: 10 }, { header: 'Auto-closed', width: 11 }, { header: 'Edited by admin', width: 14 }, { header: 'Note', width: 36 }],
      rows: rows.map((r, i) => [
        { v: i + 1, style: 'int' }, r.name, r.email, r.role.replace('_', ' ').toLowerCase(), r.teamName ?? '', r.batchName ?? '', this.stateCell(r), this.t(r.checkInAt), this.t(r.checkOutAt),
        { v: r.lateMinutes || 0, style: 'int' }, { v: this.hours(r.workedMinutes), style: 'hours' }, { v: r.breakMinutes, style: 'int' }, { v: r.breakCount, style: 'int' },
        r.mode ? r.mode.toLowerCase() : '', r.autoClosed ? 'yes' : '', r.edited ? 'yes' : '', r.note ?? '',
      ]),
    };
  }

  private breaksSheet(rows: Row[], withDate: boolean): Sheet {
    const out: Cell[][] = [];
    for (const r of rows) for (const b of r.breaks) {
      out.push([...(withDate ? [{ v: dayToDate(r.day) as any, style: 'date' } as Cell] : []), r.name, r.teamName ?? '', BREAK_LABEL[b.reason] ?? b.reason, this.t(b.startAt), b.endAt ? this.t(b.endAt) : 'still on break', { v: b.minutes, style: 'int' }, b.note ?? '']);
    }
    return {
      name: 'Breaks',
      columns: [...(withDate ? [{ header: 'Date', width: 12 }] : []), { header: 'Name', width: 26 }, { header: 'Team', width: 18 }, { header: 'Reason', width: 14 }, { header: 'Start', width: 10 }, { header: 'End', width: 14 }, { header: 'Minutes', width: 10 }, { header: 'Note', width: 36 }],
      rows: out,
    };
  }

  async export(me: RequestUser, q: { type?: string; date?: string; month?: string; from?: string; to?: string; userId?: string; teamId?: string; batchId?: string; format?: string }) {
    const type = q.type ?? 'day';
    const csv = q.format === 'csv';
    let sheets: Sheet[];
    let filename: string;

    if (type === 'day') {
      if (me.role === 'EMPLOYEE') throw new ForbiddenException('Forbidden');
      const date = q.date ?? dayStr();
      if (!isValidDay(date)) throw new BadRequestException('date must be YYYY-MM-DD');
      if (date > dayStr()) throw new BadRequestException('Cannot export a future date');
      const users = await this.scopedUsers(me, q, date);
      const { rows } = await this.compute(users, date, date);
      rows.sort((a, b) => (a.teamName ?? '~').localeCompare(b.teamName ?? '~') || a.name.localeCompare(b.name));
      const s = this.summarize(rows);
      const wd = weekday(date);
      const byTeam = new Map<string, Row[]>();
      for (const r of rows) byTeam.set(r.teamName ?? 'No team', [...(byTeam.get(r.teamName ?? 'No team') ?? []), r]);
      const sum: Cell[][] = [
        ['People on roster', { v: s.total - s.off, style: 'int' }], ['Present (checked in)', { v: s.present, style: 'int' }], ['  on time', { v: s.onTime, style: 'int' }], ['  late', { v: s.late, style: 'int' }], ['  half day', { v: s.halfDay, style: 'int' }],
        ['On leave', { v: s.leave, style: 'int' }], ['Absent / not checked in', { v: s.absent + s.notIn, style: 'int' }], ['Total worked (hrs)', { v: this.hours(s.workedMinutes), style: 'hours' }],
        ['Total break (hrs)', { v: this.hours(s.breakMinutes), style: 'hours' }], ['Over break limit', { v: s.overBreak, style: 'int' }],
      ];
      const teamRows: Cell[][] = [...byTeam.entries()].map(([name, rs]) => { const t = this.summarize(rs); return [name, { v: t.total, style: 'int' }, { v: t.present, style: 'int' }, { v: t.late, style: 'int' }, { v: t.leave, style: 'int' }, { v: t.absent + t.notIn, style: 'int' }]; });
      sheets = [
        { name: 'Summary', title: `Attendance summary · ${date} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd]})`, columns: [{ header: 'Metric', width: 28 }, { header: 'Value', width: 14 }], rows: sum },
        { name: 'By team', columns: [{ header: 'Team', width: 24 }, { header: 'People', width: 10 }, { header: 'Present', width: 10 }, { header: 'Late', width: 10 }, { header: 'On leave', width: 10 }, { header: 'Absent', width: 10 }], rows: teamRows },
        this.dailySheet(rows, `Daily attendance · ${date}`),
        this.breaksSheet(rows, false),
      ];
      filename = `attendance-daily-${date}`;
    } else if (type === 'month') {
      if (me.role === 'EMPLOYEE') throw new ForbiddenException('Forbidden');
      const { from, to } = this.rangeFrom({ month: q.month });
      const users = await this.scopedUsers(me, q, from);
      const { rows, days, working } = await this.compute(users, from, to);
      const byUser = new Map<string, Row[]>();
      for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
      const people = users.filter((u) => byUser.has(u.id));
      const summaryRows: Cell[][] = people.map((u) => {
        const rs = byUser.get(u.id)!; const s = this.personSummary(rs, working);
        return [u.displayName, u.email, u.team?.name ?? '', u.batch?.name ?? '', { v: s.workingDays, style: 'int' }, { v: s.present, style: 'int' }, { v: s.onTime, style: 'int' }, { v: s.late, style: 'int' }, { v: s.halfDay, style: 'int' }, { v: s.leave, style: 'int' }, { v: s.absent + s.notIn, style: 'int' }, { v: s.attendancePct, style: 'hours' }, { v: this.hours(s.workedMinutes), style: 'hours' }, { v: this.hours(s.avgWorkedMinutes), style: 'hours' }, { v: s.breakMinutes, style: 'int' }];
      });
      const gridCols = [{ header: 'Name', width: 26 }, { header: 'Team', width: 16 }, ...days.map((d) => ({ header: `${d.slice(8)}\n${['S', 'M', 'T', 'W', 'T', 'F', 'S'][weekday(d)]}`, width: 5 })), { header: 'P', width: 6 }, { header: 'L', width: 6 }, { header: 'H', width: 6 }, { header: 'LV', width: 6 }, { header: 'A', width: 6 }];
      const grid: Cell[][] = people.map((u) => {
        const map = new Map(byUser.get(u.id)!.map((r) => [r.day, r]));
        const cnt = { P: 0, L: 0, H: 0, LV: 0, A: 0 };
        const cells: Cell[] = days.map((d) => {
          const r = map.get(d);
          if (!r) return { v: '-', style: 'muted' };
          const code = r.state === 'LEAVE' ? GRID_CODE.LEAVE : r.checkInAt ? (r.halfDay ? GRID_CODE.HALF : r.late ? GRID_CODE.LATE : GRID_CODE.WORKING) : GRID_CODE[r.state];
          if (code === 'P') cnt.P++; else if (code === 'L') cnt.L++; else if (code === 'H') cnt.H++; else if (code === 'LV') cnt.LV++; else if (code === 'A') cnt.A++;
          return { v: code, style: code === 'P' ? 'good' : code === 'L' || code === 'H' ? 'warn' : code === 'A' ? 'bad' : 'muted' };
        });
        return [u.displayName, u.team?.name ?? '', ...cells, { v: cnt.P, style: 'int' }, { v: cnt.L, style: 'int' }, { v: cnt.H, style: 'int' }, { v: cnt.LV, style: 'int' }, { v: cnt.A, style: 'int' }];
      });
      const detail = rows.filter((r) => r.state !== 'OFF' || r.checkInAt);
      const detSheet = this.dailySheet(detail, `Details · ${from} to ${to}`);
      detSheet.name = 'Details';
      detSheet.columns.splice(1, 0, { header: 'Date', width: 12 });
      detSheet.rows = detail.map((r, i) => { const row = this.dailySheet([r], '').rows[0]; row[0] = { v: i + 1, style: 'int' }; row.splice(1, 0, { v: dayToDate(r.day) as any, style: 'date' }); return row; });
      sheets = [
        {
          name: 'Month summary', title: `Monthly attendance · ${q.month ?? from.slice(0, 7)}  (P = present, L = late, H = half day, LV = leave, A = absent)`,
          columns: [{ header: 'Name', width: 26 }, { header: 'Email', width: 30 }, { header: 'Team', width: 18 }, { header: 'Batch', width: 18 }, { header: 'Working days', width: 10 }, { header: 'Present', width: 9 }, { header: 'On time', width: 9 }, { header: 'Late', width: 8 }, { header: 'Half day', width: 9 }, { header: 'Leave', width: 8 }, { header: 'Absent', width: 8 }, { header: 'Attendance %', width: 12 }, { header: 'Total hours', width: 11 }, { header: 'Avg hrs / day', width: 12 }, { header: 'Break (min)', width: 11 }],
          rows: summaryRows,
        },
        { name: 'Day grid', title: `Attendance register · ${from} to ${to}`, columns: gridCols, rows: grid },
        detSheet,
      ];
      filename = `attendance-monthly-${from.slice(0, 7)}`;
    } else if (type === 'person') {
      const userId = q.userId ?? me.id;
      await this.assertCanSee(me, userId);
      const { from, to } = this.rangeFrom(q);
      const user = (await this.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT })) as unknown as UserLite | null;
      if (!user) throw new NotFoundException('User not found');
      const { rows, working } = await this.compute([user], from, to);
      const s = this.personSummary(rows, working);
      const days = rows.filter((r) => r.state !== 'OFF' || r.checkInAt);
      const daySheet = this.dailySheet(days, `${user.displayName} · ${from} to ${to}`);
      daySheet.name = 'Days';
      daySheet.columns.splice(1, 4, { header: 'Date', width: 12 }, { header: 'Weekday', width: 10 });
      daySheet.rows = days.map((r, i) => { const base = this.dailySheet([r], '').rows[0]; return [{ v: i + 1, style: 'int' }, { v: dayToDate(r.day) as any, style: 'date' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(r.day)], ...base.slice(6)]; });
      sheets = [
        {
          name: 'Summary', title: `${user.displayName} · attendance ${from} to ${to}`, columns: [{ header: 'Metric', width: 26 }, { header: 'Value', width: 18 }],
          rows: [['Name', user.displayName], ['Email', user.email], ['Team', user.team?.name ?? ''], ['Batch', user.batch?.name ?? ''], ['Working days', { v: s.workingDays, style: 'int' }], ['Present', { v: s.present, style: 'int' }], ['  on time', { v: s.onTime, style: 'int' }], ['  late', { v: s.late, style: 'int' }], ['  half day', { v: s.halfDay, style: 'int' }], ['On leave', { v: s.leave, style: 'int' }], ['Absent', { v: s.absent + s.notIn, style: 'int' }], ['Attendance %', { v: s.attendancePct, style: 'hours' }], ['Total worked (hrs)', { v: this.hours(s.workedMinutes), style: 'hours' }], ['Average hrs / present day', { v: this.hours(s.avgWorkedMinutes), style: 'hours' }], ['Total break (min)', { v: s.breakMinutes, style: 'int' }]],
        },
        daySheet,
        this.breaksSheet(days, true),
      ];
      filename = `attendance-${user.displayName.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'person'}-${from.slice(0, 10)}_${to.slice(0, 10)}`;
    } else {
      throw new BadRequestException('type must be day, month or person');
    }

    if (csv) {
      const main = sheets.find((s) => ['Daily', 'Details', 'Days'].includes(s.name)) ?? sheets[0];
      return { filename: `${filename}.csv`, mime: 'text/csv; charset=utf-8', body: Buffer.from(this.toCsv(main)) };
    }
    return { filename: `${filename}.xlsx`, mime: XLSX_MIME, body: buildXlsx(sheets) };
  }

  private toCsv(sh: Sheet): string {
    const cell = (c: Cell): string => {
      let v: any = c && typeof c === 'object' && !(c instanceof Date) ? c.v : c;
      if (v instanceof Date) v = `${v.toISOString().slice(0, 10)} ${v.toISOString().slice(11, 16)}`.replace(/^1970-01-01 /, '').replace(/^1899-12-30 /, '');
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return '\uFEFF' + [sh.columns.map((c) => cell(c.header.replace('\n', ' '))).join(','), ...sh.rows.map((r) => sh.columns.map((_, i) => cell(r[i])).join(','))].join('\n') + '\n';
  }

  // =====================================================================
  //  Automatic jobs (called every minute by JobsService)
  // =====================================================================
  private async alreadySent(userIds: string[], link: string, since: Date) {
    return (await this.prisma.notification.count({ where: { userId: { in: userIds }, type: 'ATTENDANCE', link, createdAt: { gte: since } } })) > 0;
  }

  async runJobs() {
    const today = dayStr();
    const cfg = await this.calendar.attendanceConfig();
    const working = await this.calendar.isWorkingDay(today);
    const nowMin = minutesOfDay();
    await this.breakWatch(cfg);
    if (working && nowMin >= cfg.shiftStart + cfg.graceMinutes + 10 && nowMin < cfg.shiftEnd) await this.nudgeNotCheckedIn(today);
    if (working && nowMin >= cfg.shiftEnd + 30 && nowMin < cfg.autoCheckout + 120) await this.endOfDaySummary(today);
    if (nowMin >= cfg.autoCheckout) await this.autoClose(today);
    // a forgotten check-out from yesterday must never stay open
    if (nowMin < cfg.autoCheckout) await this.autoClose(addDays(today, -1));
  }

  /** Someone has been on one break longer than the limit: ask them, and tell their lead once. */
  private async breakWatch(cfg: AttendanceConfig) {
    const cutoff = new Date(Date.now() - cfg.maxSingleBreakMinutes * 60_000);
    const longBreaks = await this.prisma.breakLog.findMany({
      where: { endAt: null, overNotified: false, startAt: { lt: cutoff } }, take: 100,
      include: { user: { select: { id: true, displayName: true, teamId: true, team: { select: { leadId: true, coordinatorId: true } } } } },
    });
    for (const b of longBreaks) {
      const mins = Math.floor((Date.now() - b.startAt.getTime()) / 60_000);
      await this.notifications.notify([b.user.id], { type: 'ATTENDANCE', title: 'Still on break?', body: `Your ${BREAK_LABEL[b.reason].toLowerCase()} break is ${fmtMinutes(mins)} long. Tap to end it when you are back.`, link: '/attendance' });
      const staff = [b.user.team?.leadId, b.user.team?.coordinatorId].filter((x): x is string => !!x && x !== b.user.id);
      await this.notifications.notify(staff, { type: 'ATTENDANCE', title: `${b.user.displayName} is on a long break`, body: `${BREAK_LABEL[b.reason]} · ${fmtMinutes(mins)} so far`, link: '/attendance' });
      await this.prisma.breakLog.update({ where: { id: b.id }, data: { overNotified: true } });
    }
  }

  private async nudgeNotCheckedIn(today: string) {
    const { start } = dayRange(today);
    const users = await this.prisma.user.findMany({
      where: { isActive: true, role: { not: 'ADMIN' }, createdAt: { lt: start } },
      select: { id: true, displayName: true, teamId: true, team: { select: { name: true, leadId: true, coordinatorId: true } } },
    });
    if (!users.length) return;
    const present = new Set((await this.prisma.attendanceDay.findMany({ where: { day: dayToDate(today), userId: { in: users.map((u) => u.id) } }, select: { userId: true } })).map((r) => r.userId));
    const missing = users.filter((u) => !present.has(u.id));
    if (!missing.length) return;
    const link = `/attendance?nudge=${today}`;
    const already = new Set((await this.prisma.notification.findMany({ where: { type: 'ATTENDANCE', link, createdAt: { gte: start }, userId: { in: users.map((u) => u.id) } }, select: { userId: true } })).map((n) => n.userId));
    const fresh = missing.filter((u) => !already.has(u.id));
    if (!fresh.length) return;
    await this.notifications.notify(fresh.map((u) => u.id), { type: 'ATTENDANCE', title: 'You have not checked in yet', body: 'Tap to mark your attendance for today.', link });
    const byTeam = new Map<string, typeof fresh>();
    for (const u of fresh) if (u.teamId) byTeam.set(u.teamId, [...(byTeam.get(u.teamId) ?? []), u]);
    for (const [, list] of byTeam) {
      const t = list[0].team!;
      const staff = [t.leadId, t.coordinatorId].filter((x): x is string => !!x);
      if (!staff.length) continue;
      const names = list.slice(0, 6).map((u) => u.displayName).join(', ') + (list.length > 6 ? ` +${list.length - 6} more` : '');
      await this.notifications.notify(staff, { type: 'ATTENDANCE', title: `${list.length} not checked in · ${t.name}`, body: names, link: '/attendance' });
    }
  }

  /** After shift end: one summary per team to its lead + coordinator, one for admins. Sent once per day. */
  private async endOfDaySummary(today: string) {
    const { start } = dayRange(today);
    const teams = await this.prisma.team.findMany({ select: { id: true, name: true, leadId: true, coordinatorId: true } });
    const admins = (await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })).map((a) => a.id);
    const adminLink = `/attendance?summary=${today}`;
    const all = await this.prisma.user.findMany({ where: { isActive: true }, select: USER_SELECT });
    const { rows } = await this.compute(all as unknown as UserLite[], today, today);
    const line = (rs: Row[]) => {
      const s = this.summarize(rs);
      const absent = rs.filter((r) => r.state === 'NOT_IN' || r.state === 'ABSENT').map((r) => r.name);
      return { s, text: `${s.present}/${s.total - s.off} present · ${s.late} late · ${s.halfDay} half day · ${s.leave} leave · ${absent.length} absent${absent.length ? ` (${absent.slice(0, 5).join(', ')}${absent.length > 5 ? '…' : ''})` : ''}` };
    };
    for (const t of teams) {
      const staff = [t.leadId, t.coordinatorId].filter((x): x is string => !!x);
      const link = `/attendance?summary=${today}&team=${t.id}`;
      if (!staff.length || (await this.alreadySent(staff, link, start))) continue;
      const rs = rows.filter((r) => r.teamId === t.id);
      if (!rs.length) continue;
      await this.notifications.notify(staff, { type: 'ATTENDANCE', title: `Attendance today · ${t.name}`, body: line(rs).text, link });
    }
    if (admins.length && !(await this.alreadySent(admins, adminLink, start)) && rows.length) {
      await this.notifications.notify(admins, { type: 'ATTENDANCE', title: 'Attendance summary for today is ready', body: line(rows).text, link: adminLink });
    }
  }

  /** People who forgot to check out are closed at the configured time and flagged "auto-closed" for review. */
  private async autoClose(day: string) {
    const cfg = await this.calendar.attendanceConfig();
    const open = await this.prisma.attendanceDay.findMany({
      where: { day: dayToDate(day), checkInAt: { not: null }, checkOutAt: null }, include: { breaks: true }, take: 500,
    });
    const nowD = new Date();
    const cap = localTimeToInstant(day, `${Math.floor(cfg.autoCheckout / 60)}:${String(cfg.autoCheckout % 60).padStart(2, '0')}`);
    for (const rec of open) {
      const at = nowD < cap ? nowD : cap;
      if (at <= rec.checkInAt!) continue;
      await this.closeRecord(rec, at, { note: 'Auto check-out (forgot to check out)', auto: true });
      await this.notifications.notify([rec.userId], { type: 'ATTENDANCE', title: 'You were checked out automatically', body: 'You did not check out. Your lead can correct the time if needed.', link: '/attendance' });
      this.changed(rec.userId, rec.teamId);
    }
  }
}
