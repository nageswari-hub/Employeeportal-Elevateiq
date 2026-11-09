import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../comms/notifications.service';
import { WorkCalendarService } from '../../common/work-calendar.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { dayStr, dayToDate, addDays } from '../../common/time';
import { CreateMeetingDto, RequestLeaveDto } from './dto/workplace.dto';

const LEAD_ROLES = ['ADMIN', 'TEAM_LEAD'];

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

@Injectable()
export class WorkplaceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private calendar: WorkCalendarService,
  ) {}

  // ---------------- meetings ----------------
  async createMeeting(me: RequestUser, dto: CreateMeetingDto, ip?: string) {
    if (!LEAD_ROLES.includes(me.role)) throw new ForbiddenException('Only leads and admins schedule meetings');

    const audience = dto.audience ?? (dto.teamId ? 'TEAM' : 'COMPANY');
    let teamId = dto.teamId ?? null;
    let attendeeIds: string[] = [];

    if (audience === 'COMPANY') {
      if (me.role !== 'ADMIN') throw new ForbiddenException('Company meetings are admin-only');
      teamId = null;
    } else if (audience === 'LEADS') {
      if (me.role !== 'ADMIN') throw new ForbiddenException('Only admins can schedule meetings for team leads');
    } else if (audience === 'TEAM' || audience === 'USERS') {
      if (me.role === 'TEAM_LEAD') {
        teamId = teamId ?? me.teamId;
        if (!me.teamId || teamId !== me.teamId) throw new ForbiddenException('Outside your team');
      }
      if (!teamId) throw new BadRequestException('teamId required for a team meeting');
    }

    if (teamId) {
      const t = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (!t) throw new BadRequestException('Invalid teamId');
      if (me.role === 'TEAM_LEAD' && me.teamId !== teamId) throw new ForbiddenException('Outside your team');
    }

    if (audience === 'USERS') {
      const ids = [...new Set((dto.userIds ?? []).filter(Boolean))];
      if (!ids.length) throw new BadRequestException('Select at least one person for this meeting');
      const users = await this.prisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, teamId: true } });
      if (users.length !== ids.length) throw new BadRequestException('One or more selected people are invalid');
      if (me.role === 'TEAM_LEAD' && users.some((u) => u.teamId !== teamId && u.id !== me.id))
        throw new ForbiddenException('You can only invite people from your team');
      attendeeIds = ids;
    }

    if (!isHttpUrl(dto.meetUrl)) throw new BadRequestException('meetUrl must be an http(s) link');
    const startsAt = new Date(dto.startsAt);
    if (isNaN(startsAt.getTime())) throw new BadRequestException('Invalid startsAt');
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && (isNaN(endsAt.getTime()) || endsAt <= startsAt)) throw new BadRequestException('endsAt must be after startsAt');
    const m = await this.prisma.meeting.create({
      data: {
        teamId, title: dto.title.trim(), meetUrl: dto.meetUrl.trim(), startsAt, endsAt,
        recurrence: dto.recurrence ?? 'NONE', audience, attendeeIds, createdById: me.id,
      },
    });
    const ids = await this.meetingRecipientIds(m, me.id);
    await this.notifications.notify(ids, {
      type: 'ANNOUNCEMENT', title: `Meeting: ${m.title}`, body: `Join at ${startsAt.toLocaleString()}`, link: '/dashboard',
    });
    await this.audit.log({ actorId: me.id, action: 'MEETING_CREATE', entity: 'meeting', entityId: m.id, ip });
    return m;
  }

  /** Everyone who should be told about a meeting (excluding the organiser). */
  private async meetingRecipientIds(m: { teamId: string | null; audience: string; attendeeIds: string[] }, except: string): Promise<string[]> {
    const where: any = { isActive: true };
    if (m.audience === 'COMPANY') {
      // everyone
    } else if (m.audience === 'LEADS') {
      where.role = 'TEAM_LEAD';
      if (m.teamId) where.teamId = m.teamId;
    } else if (m.audience === 'USERS') {
      where.id = { in: m.attendeeIds.length ? m.attendeeIds : ['__none__'] };
    } else {
      where.teamId = m.teamId ?? '__none__';
    }
    const rows = await this.prisma.user.findMany({ where, select: { id: true }, take: 1000 });
    return rows.map((r) => r.id).filter((id) => id !== except);
  }

  /** Prisma filter for meetings a user is allowed to see. */
  private meetingVisibility(me: RequestUser): any {
    if (me.role === 'ADMIN') return {};
    const or: any[] = [{ audience: 'COMPANY' }, { attendeeIds: { has: me.id } }];
    if (me.teamId) or.push({ teamId: me.teamId });
    if (me.role === 'TEAM_LEAD') or.push({ audience: 'LEADS' });
    return { OR: or };
  }

  listMeetings(me: RequestUser, scope: 'upcoming' | 'past' | 'all' = 'upcoming') {    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const scopeWhere =
      scope === 'upcoming'
        ? { OR: [{ endsAt: null, startsAt: { gte: hourAgo } }, { endsAt: { gte: now } }] }
        : scope === 'past'
          ? { OR: [{ endsAt: null, startsAt: { lt: hourAgo } }, { endsAt: { lt: now } }] }
          : {};
    return this.prisma.meeting.findMany({
      where: {
        recurrence: 'NONE', // templates never listed; their daily instances are
        AND: [this.meetingVisibility(me), scopeWhere],
      },
      orderBy: scope === 'past' ? { startsAt: 'desc' } : { startsAt: 'asc' },
      take: 50,
      include: { team: { select: { id: true, name: true } } },
    });
  }

  async deleteMeeting(me: RequestUser, id: string, ip?: string) {    const m = await this.prisma.meeting.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Meeting not found');
    const allowed = me.role === 'ADMIN' || m.createdById === me.id || (me.role === 'TEAM_LEAD' && !!me.teamId && m.teamId === me.teamId);
    if (!allowed) throw new ForbiddenException('Forbidden');
    await this.prisma.meeting.delete({ where: { id } });
    await this.audit.log({ actorId: me.id, action: 'MEETING_DELETE', entity: 'meeting', entityId: id, ip });
    return { ok: true };
  }

  // ---------------- leaves ----------------
  async requestLeave(me: RequestUser, dto: RequestLeaveDto, ip?: string) {
    const from = dto.fromDate.slice(0, 10);
    const to = dto.toDate.slice(0, 10);
    if (from > to) throw new BadRequestException('fromDate must be on or before toDate');
    const today = dayStr();
    if (from < addDays(today, -2)) throw new BadRequestException('Cannot request leave older than 2 days back');
    if (to > addDays(today, 180)) throw new BadRequestException('Cannot request leave more than 180 days ahead');
    // count working days in range (cap walk at 200 days for safety)
    let days = 0;
    for (let d = from, n = 0; d <= to && n < 200; d = addDays(d, 1), n++) days++;
    if (days > 60) throw new BadRequestException('One request covers at most 60 days');
    const overlap = await this.prisma.leaveRequest.findFirst({
      where: { userId: me.id, status: { in: ['PENDING', 'APPROVED'] }, fromDate: { lte: dayToDate(to) }, toDate: { gte: dayToDate(from) } },
      select: { id: true },
    });
    if (overlap) throw new BadRequestException('You already have a pending/approved leave covering these dates');
    const r = await this.prisma.leaveRequest.create({
      data: { userId: me.id, teamId: me.teamId ?? null, fromDate: dayToDate(from), toDate: dayToDate(to), reason: dto.reason.trim(), status: 'PENDING' as any },
    });
    const pending = r;
    const staff = me.teamId
      ? await this.prisma.user.findMany({ where: { teamId: me.teamId, isActive: true, role: { in: ['TEAM_LEAD', 'COORDINATOR'] } }, select: { id: true } })
      : [];
    await this.notifications.notify(staff.map((s) => s.id), {
      type: 'REPORT_MISSING', title: `Leave request: ${me.id}`, body: `${from} → ${to}: ${dto.reason.trim().slice(0, 200)}`, link: '/leaves',
    });
    await this.audit.log({ actorId: me.id, action: 'LEAVE_REQUEST', entity: 'leave', entityId: r.id, ip });
    return pending;
  }

  mine(me: RequestUser) {
    return this.prisma.leaveRequest.findMany({
      where: { userId: me.id }, orderBy: { createdAt: 'desc' }, take: 100,
      include: { decidedBy: { select: { id: true, displayName: true } } },
    });
  }

  /** Admins see every leave; leads see their team. Includes decided/cancelled rows so history is visible. */
  async all(me: RequestUser) {
    if (!['ADMIN', 'TEAM_LEAD'].includes(me.role)) throw new ForbiddenException('Forbidden');
    const where: any = {};
    if (me.role !== 'ADMIN') {
      if (!me.teamId) return [];
      where.teamId = me.teamId;
    }
    return this.prisma.leaveRequest.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 300,
      include: {
        user: { select: { id: true, displayName: true, email: true } },
        decidedBy: { select: { id: true, displayName: true } },
      },
    });
  }

  async pending(me: RequestUser) {
    if (!['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(me.role)) throw new ForbiddenException('Forbidden');
    const where: any = { status: 'PENDING' };
    if (me.role !== 'ADMIN') {
      if (!me.teamId) return [];
      where.teamId = me.teamId;
    }
    return this.prisma.leaveRequest.findMany({
      where, orderBy: { createdAt: 'asc' }, take: 100,
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
  }

  async decide(me: RequestUser, id: string, approve: boolean, note: string | undefined, ip?: string) {
    if (!['ADMIN', 'TEAM_LEAD'].includes(me.role)) throw new ForbiddenException('Only leads/admins decide leaves');
    const r = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Leave not found');
    if (r.status !== 'PENDING') throw new BadRequestException(`Already ${r.status.toLowerCase()}`);
    if (me.role === 'TEAM_LEAD' && (!me.teamId || r.teamId !== me.teamId)) throw new ForbiddenException('Outside your team');
    const status = approve ? 'APPROVED' : 'REJECTED';
    const updated = await this.prisma.leaveRequest.update({
      where: { id }, data: { status: status as any, decidedById: me.id, decidedAt: new Date() },
    });
    if (approve) await this.markOnLeave(r.userId, r.fromDate, r.toDate);
    await this.notifications.notify([r.userId], {
      type: 'REPORT_MISSING',
      title: approve ? 'Leave approved' : 'Leave rejected',
      body: `${this.fmt(r.fromDate)} → ${this.fmt(r.toDate)}${note ? `: ${note}` : ''}`,
      link: '/leaves',
    });
    await this.audit.log({ actorId: me.id, action: approve ? 'LEAVE_APPROVE' : 'LEAVE_REJECT', entity: 'leave', entityId: id, ip });
    return updated;
  }

  async cancel(me: RequestUser, id: string, ip?: string) {
    const r = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Leave not found');
    const staff = me.role === 'ADMIN' || me.role === 'TEAM_LEAD';
    if (r.userId !== me.id && !staff) throw new NotFoundException('Leave not found');
    if (staff && me.role === 'TEAM_LEAD' && (!me.teamId || r.teamId !== me.teamId)) throw new ForbiddenException('Outside your team');
    if (r.status !== 'PENDING') throw new BadRequestException('Only pending requests can be cancelled');
    const updated = await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' as any } });
    await this.audit.log({ actorId: me.id, action: 'LEAVE_CANCEL', entity: 'leave', entityId: id, ip });
    return updated;
  }

  async revoke(me: RequestUser, id: string, ip?: string) {
    if (!['ADMIN', 'TEAM_LEAD'].includes(me.role)) throw new ForbiddenException('Only leads/admins');
    const r = await this.prisma.leaveRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Leave not found');
    if (r.status !== 'APPROVED') throw new BadRequestException('Only approved future leaves can be revoked');
    if (this.fmt(r.fromDate) < dayStr()) throw new BadRequestException('Cannot revoke a leave that already started');
    if (me.role === 'TEAM_LEAD' && (!me.teamId || r.teamId !== me.teamId)) throw new ForbiddenException('Outside your team');
    const updated = await this.prisma.leaveRequest.update({ where: { id }, data: { status: 'CANCELLED' as any, decidedById: me.id, decidedAt: new Date() } });
    // revert auto-marked days that are still untouched (no check-in recorded)
    await this.prisma.attendanceDay.deleteMany({ where: { userId: r.userId, status: 'ON_LEAVE', checkInAt: null, day: { gte: r.fromDate, lte: r.toDate } } });
    await this.audit.log({ actorId: me.id, action: 'LEAVE_REVOKE', entity: 'leave', entityId: id, ip });
    return updated;
  }

  onLeaveToday(me: RequestUser) {
    const where: any = {};
    if (me.role !== 'ADMIN') {
      if (!me.teamId) return Promise.resolve([]);
      where.teamId = me.teamId;
    }
    return this.prisma.leaveRequest.findMany({
      where: { ...where, status: 'APPROVED', fromDate: { lte: new Date(dayStr()) }, toDate: { gte: new Date(dayStr()) } },
      include: { user: { select: { id: true, displayName: true } } },
      take: 200,
    });
  }

  // ---------------- shared meeting notes ----------------
  async saveNote(me: RequestUser, id: string, note: string, ip?: string) {
    const m = await this.prisma.meeting.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Meeting not found');
    if (!this.canSeeMeeting(me, m.teamId)) throw new ForbiddenException('Forbidden');
    const updated = await this.prisma.meeting.update({
      where: { id },
      data: { note: note.trim(), noteUpdatedAt: new Date(), noteUpdatedById: me.id },
      include: { noteUpdatedBy: { select: { id: true, displayName: true } } },
    });
    await this.audit.log({ actorId: me.id, action: 'MEETING_NOTE', entity: 'meeting', entityId: id, ip });
    return updated;
  }

  // ---------------- team calendar: meetings + leaves + holidays ----------------
  async monthView(me: RequestUser, month: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
    const monthStart = new Date(`${month}-01T00:00:00Z`);
    const nextMonth = new Date(monthStart);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const taskWhere: any = { dueDate: { gte: monthStart, lt: nextMonth } };
    if (me.role === 'EMPLOYEE') {
      const collab = await this.prisma.taskCollaborator.findMany({ where: { userId: me.id }, select: { taskId: true } });
      taskWhere.OR = [{ ownerId: me.id }, { id: { in: collab.map((c) => c.taskId) } }];
    } else if (me.role === 'COORDINATOR') {
      taskWhere.teamId = me.teamId ?? '__none__';
    }
    const [meetings, tasks, leaves, holidays] = await Promise.all([
      this.prisma.meeting.findMany({
        where: {
          recurrence: 'NONE',
          startsAt: { gte: monthStart, lt: nextMonth },
          ...this.meetingVisibility(me),
        },
        orderBy: { startsAt: 'asc' },
        include: { team: { select: { id: true, name: true } } },
        take: 500,
      }),
      this.prisma.task.findMany({
        where: taskWhere,
        orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
        select: {
          id: true, title: true, status: true, priority: true, dueDate: true,
          owner: { select: { id: true, displayName: true } },
        },
        take: 1000,
      }),
      this.prisma.leaveRequest.findMany({
        where: {
          status: 'APPROVED',
          fromDate: { lt: nextMonth },
          toDate: { gte: monthStart },
          ...(me.role === 'ADMIN' ? {} : me.role === 'EMPLOYEE' ? { userId: me.id } : me.teamId ? { teamId: me.teamId } : { userId: me.id }),
        },
        include: { user: { select: { id: true, displayName: true } } },
        take: 500,
      }),
      this.calendar.holidaySet(),
    ]);
    const days: Record<string, { meetings: unknown[]; tasks: unknown[]; leaves: unknown[]; isHoliday: boolean; isWorkingDay: boolean }> = {};
    const dayList: string[] = [];
    for (let d = new Date(monthStart); d < nextMonth; d = new Date(d.getTime() + 86_400_000)) {
      dayList.push(d.toISOString().slice(0, 10));
    }
    for (const d of dayList) {
      days[d] = {
        meetings: meetings.filter((m) => m.startsAt.toISOString().slice(0, 10) === d).map((m) => ({ id: m.id, title: m.title, startsAt: m.startsAt, meetUrl: m.meetUrl, team: m.team })),
        tasks: tasks.filter((t) => t.dueDate && this.fmt(t.dueDate) === d),
        leaves: leaves
          .filter((l) => this.fmt(l.fromDate) <= d && d <= this.fmt(l.toDate))
          .map((l) => ({ user: l.user.displayName, fromDate: this.fmt(l.fromDate), toDate: this.fmt(l.toDate) })),
        isHoliday: holidays.has(d),
        isWorkingDay: await this.calendar.isWorkingDay(d),
      };
    }
    return { month, days };
  }

  private canSeeMeeting(me: RequestUser, teamId: string | null): boolean {
    if (teamId === null) return true;
    if (me.role === 'ADMIN' || me.role === 'TEAM_LEAD') return true;
    return me.teamId === teamId;
  }

  private fmt(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private async markOnLeave(userId: string, from: Date, to: Date) {
    let d = this.fmt(from);
    const end = this.fmt(to);
    for (let n = 0; d <= end && n < 200; d = addDays(d, 1), n++) {
      if (!(await this.calendar.isWorkingDay(d))) continue;
      await this.prisma.attendanceDay.upsert({
        where: { userId_day: { userId, day: dayToDate(d) } },
        update: {},
        create: { userId, day: dayToDate(d), status: 'ON_LEAVE' as any },
      });
    }
  }

  private async scopeUserIds(teamId: string | null, except: string): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { isActive: true, ...(teamId ? { teamId } : {}) }, select: { id: true }, take: 500,
    });
    return rows.map((r) => r.id).filter((id) => id !== except);
  }
}
