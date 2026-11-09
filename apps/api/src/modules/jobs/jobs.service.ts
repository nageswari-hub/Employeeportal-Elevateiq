import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../comms/notifications.service';
import { WorkCalendarService } from '../../common/work-calendar.service';
import { AttendanceService } from '../attendance/attendance.service';
import { FilesService } from '../files/files.service';
import { dayRange, dayStr, dayToDate, minutesOfDay, APP_TZ } from '../../common/time';

/**
 * Background automation without extra infrastructure (no Redis/cron container).
 * Every job is idempotent and checks the database before acting, so a restart or a double tick never spams anyone.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Jobs');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private calendar: WorkCalendarService,
    private attendance: AttendanceService,
    private files: FilesService,
  ) {}

  onModuleInit() {
    if (process.env.JOBS_ENABLED === 'false' || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    setTimeout(() => void this.tick(), 15_000).unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.attendance.runJobs().catch((e) => this.log.error(`attendance jobs: ${e?.message ?? e}`));
      await this.reportReminders();
      await this.missingReportDigest();
      await this.meetingReminders();
      await this.ensureDailyMeetings();
      await this.dailyCleanup();
    } catch (e: any) {
      this.log.error(`tick failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }

  /** 30 minutes before the deadline: nudge everyone who has not reported yet. */
  private async reportReminders() {
    const today = dayStr();
    if (!(await this.calendar.isWorkingDay(today))) return;
    const deadline = await this.calendar.deadlineMinutes();
    const now = minutesOfDay();
    if (now < deadline - 30 || now >= deadline) return;

    const { start } = dayRange(today);
    const members = await this.prisma.user.findMany({
      where: { isActive: true, role: { not: 'ADMIN' }, createdAt: { lt: start } },
      select: { id: true },
    });
    if (!members.length) return;
    const ids = members.map((m) => m.id);
    const [reported, reminded] = await Promise.all([
      this.prisma.dailyReport.findMany({ where: { reportDate: dayToDate(today), userId: { in: ids } }, select: { userId: true } }),
      this.prisma.notification.findMany({ where: { type: 'REPORT_REMINDER', userId: { in: ids }, createdAt: { gte: start } }, select: { userId: true } }),
    ]);
    const skip = new Set([...reported.map((r) => r.userId), ...reminded.map((r) => r.userId)]);
    const targets = ids.filter((id) => !skip.has(id));
    if (!targets.length) return;
    const hh = String(Math.floor(deadline / 60)).padStart(2, '0');
    const mm = String(deadline % 60).padStart(2, '0');
    await this.notifications.notify(targets, {
      type: 'REPORT_REMINDER', title: 'Daily report due soon', body: `Submit your update before ${hh}:${mm}.`, link: '/reports',
    });
    this.log.log(`report reminder sent to ${targets.length} people`);
  }

  /** After the deadline: tell each team's coordinator and lead who is still missing (once per day). */
  private async missingReportDigest() {
    const today = dayStr();
    if (!(await this.calendar.isWorkingDay(today))) return;
    const deadline = await this.calendar.deadlineMinutes();
    const now = minutesOfDay();
    if (now < deadline + 15 || now >= deadline + 180) return;

    const { start } = dayRange(today);
    const teams = await this.prisma.team.findMany({ select: { id: true, name: true, leadId: true, coordinatorId: true } });
    for (const t of teams) {
      const recipients = [t.leadId, t.coordinatorId].filter((x): x is string => Boolean(x));
      if (!recipients.length) continue;
      const already = await this.prisma.notification.count({ where: { type: 'REPORT_MISSING', userId: { in: recipients }, createdAt: { gte: start }, link: `/reports?team=${t.id}` } });
      if (already) continue;
      const members = await this.prisma.user.findMany({
        where: { teamId: t.id, isActive: true, role: { not: 'ADMIN' }, createdAt: { lt: start } }, select: { id: true, displayName: true },
      });
      if (!members.length) continue;
      const reported = new Set(
        (await this.prisma.dailyReport.findMany({ where: { reportDate: dayToDate(today), userId: { in: members.map((m) => m.id) } }, select: { userId: true } })).map((r) => r.userId),
      );
      const missing = members.filter((m) => !reported.has(m.id));
      if (!missing.length) continue;
      const names = missing.slice(0, 6).map((m) => m.displayName).join(', ') + (missing.length > 6 ? ` +${missing.length - 6} more` : '');
      await this.notifications.notify(recipients, {
        type: 'REPORT_MISSING', title: `${missing.length} missing report${missing.length > 1 ? 's' : ''} in ${t.name}`, body: names, link: `/reports?team=${t.id}`,
      });
    }
  }

  /** 15 minutes before a meeting starts: push everyone who should join (once per meeting). */
  async meetingReminders() {
    const now = new Date();
    const horizon = new Date(now.getTime() + 15 * 60_000);
    const upcoming = await this.prisma.meeting.findMany({
      where: { startsAt: { gt: now, lte: horizon } },
      select: { id: true, title: true, teamId: true, audience: true, attendeeIds: true, startsAt: true },
    });
    for (const m of upcoming) {
      const link = `/dashboard?meeting=${m.id}`;
      const already = await this.prisma.notification.count({ where: { type: 'MEETING_REMINDER', link } });
      if (already) continue;
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
      const members = await this.prisma.user.findMany({ where, select: { id: true } });
      if (!members.length) continue;
      const at = m.startsAt.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      await this.notifications.notify(members.map((x) => x.id), {
        type: 'MEETING_REMINDER', title: `Meeting in 15 min: ${m.title}`, body: `Starts at ${at}. Open Meetings on your dashboard to join.`, link,
      });
      this.log.log(`meeting reminder sent for "${m.title}" to ${members.length} people`);
    }
  }

  /** Daily meetings: make sure today's instance exists for every DAILY template. */
  async ensureDailyMeetings() {
    const today = dayStr();
    const { start, end } = dayRange(today);
    const templates = await this.prisma.meeting.findMany({ where: { recurrence: 'DAILY' } });
    for (const t of templates) {
      const hm = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(t.startsAt);
      const [hh, mm] = hm.split(':').map(Number);
      const at = new Date(start.getTime() + (hh * 60 + mm) * 60_000);
      const exists = await this.prisma.meeting.findFirst({ where: { parentId: t.id, startsAt: { gte: start, lt: end } }, select: { id: true } });
      if (exists) continue;
      await this.prisma.meeting.create({
        data: { teamId: t.teamId, title: t.title, meetUrl: t.meetUrl, startsAt: at, recurrence: 'NONE', parentId: t.id, createdById: t.createdById, audience: t.audience, attendeeIds: t.attendeeIds },
      });
      this.log.log(`materialized daily meeting "${t.title}" for ${today}`);
    }
  }

  /** Once a day (after 02:00 local): keep tables small. */
  private async dailyCleanup() {
    if (minutesOfDay() < 120) return;
    const today = dayStr();
    const marker = await this.prisma.setting.findUnique({ where: { key: 'lastCleanupDay' } });
    if ((marker?.value as any)?.day === today) return;
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    const [n1, n2, n3, n4] = await Promise.all([
      this.prisma.notification.deleteMany({ where: { isRead: true, createdAt: { lt: days(45) } } }),
      this.prisma.notification.deleteMany({ where: { createdAt: { lt: days(180) } } }),
      this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: days(Number(process.env.AUDIT_RETENTION_DAYS ?? 365)) } } }),
      this.prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: days(7) } }, { revokedAt: { lt: days(7) } }] } }),
    ]);
    await this.prisma.setting.upsert({ where: { key: 'lastCleanupDay' }, update: { value: { day: today } }, create: { key: 'lastCleanupDay', value: { day: today } } });
    const f = await this.files.sweep().catch((e) => { this.log.error(`file sweep: ${e?.message ?? e}`); return null; });
    if (f) this.log.log(`files: abandoned ${f.abandoned}, purged ${f.purged}, tmp ${f.tmpRemoved}`);
    this.log.log(`cleanup: notifications ${n1.count + n2.count}, audit ${n3.count}, tokens ${n4.count}`);
  }
}
