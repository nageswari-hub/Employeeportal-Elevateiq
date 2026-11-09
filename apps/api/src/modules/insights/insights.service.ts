import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { WorkCalendarService } from '../../common/work-calendar.service';
import { addDays, dayRange, dayStr, dayToDate } from '../../common/time';

// Kept for exports.service.ts / older imports. The real logic lives in common/time.ts (timezone is configurable via APP_TZ).
export function istDay(d: Date): string {
  return dayStr(d);
}
export function istMidnight(dateStr: string): Date {
  return dayToDate(dateStr);
}

function rate(done: number, total: number): number {
  if (!total) return 0;
  return Math.round((done / total) * 1000) / 10;
}

type Severity = 'high' | 'medium' | 'low';
export interface AttentionItem {
  userId: string;
  name: string;
  severity: Severity;
  score: number;
  reasons: string[];
  taskIds: string[];
}

@Injectable()
export class InsightsService {
  constructor(private prisma: PrismaService, private calendar: WorkCalendarService) {}

  // tiny TTL memo: the admin dashboard is the heaviest read and the same for everyone
  private memo = new Map<string, { exp: number; v: any }>();
  private async cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.memo.get(key);
    if (hit && hit.exp > Date.now()) return hit.v as T;
    const v = await fn();
    this.memo.set(key, { exp: Date.now() + ttlMs, v });
    if (this.memo.size > 200) this.memo.clear();
    return v;
  }

  // ---------- ADMIN: company-wide (constant number of queries, whatever the team count) ----------
  adminOverview() {
    return this.cached('admin', 20_000, () => this.computeAdmin());
  }

  private async computeAdmin() {
    const todayStr = dayStr();
    const today = dayToDate(todayStr);
    const now = new Date();
    const [users, tasksByStatus, overdue, blocked, reportsToday, lateToday, teams, batches, membersByTeam, membersByBatch, repByTeam, repByBatch, taskByTeamStatus] =
      await Promise.all([
        this.prisma.user.groupBy({ by: ['role'], _count: true }),
        this.prisma.task.groupBy({ by: ['status'], _count: true }),
        this.prisma.task.count({ where: { dueDate: { lt: now }, status: { not: 'DONE' } } }),
        this.prisma.task.count({ where: { status: 'BLOCKED' } }),
        this.prisma.dailyReport.count({ where: { reportDate: today } }),
        this.prisma.dailyReport.count({ where: { reportDate: today, isLate: true } }),
        this.prisma.team.findMany({ select: { id: true, name: true } }),
        this.prisma.batch.findMany({ select: { id: true, name: true } }),
        this.prisma.user.groupBy({ by: ['teamId'], where: { isActive: true, role: { not: 'ADMIN' } }, _count: true }),
        this.prisma.user.groupBy({ by: ['batchId'], where: { isActive: true, role: { not: 'ADMIN' } }, _count: true }),
        this.prisma.dailyReport.groupBy({ by: ['teamId'], where: { reportDate: today }, _count: true }),
        this.prisma.dailyReport.groupBy({ by: ['batchId'], where: { reportDate: today }, _count: true }),
        this.prisma.task.groupBy({ by: ['teamId', 'status'], _count: true }),
      ]);
    const activeUsers = membersByTeam.reduce((s, r) => s + r._count, 0);

    const mT = new Map(membersByTeam.map((r) => [r.teamId, r._count]));
    const mB = new Map(membersByBatch.map((r) => [r.batchId, r._count]));
    const rT = new Map(repByTeam.map((r) => [r.teamId, r._count]));
    const rB = new Map(repByBatch.map((r) => [r.batchId, r._count]));
    const tTotal = new Map<string, number>();
    const tDone = new Map<string, number>();
    for (const r of taskByTeamStatus) {
      if (!r.teamId) continue;
      tTotal.set(r.teamId, (tTotal.get(r.teamId) ?? 0) + r._count);
      if (r.status === 'DONE') tDone.set(r.teamId, r._count);
    }

    const leaderboard = teams
      .map((t) => {
        const members = mT.get(t.id) ?? 0;
        const rep = rT.get(t.id) ?? 0;
        return { teamId: t.id, name: t.name, members, reportRate: rate(rep, members), taskDoneRate: rate(tDone.get(t.id) ?? 0, tTotal.get(t.id) ?? 0), reportsToday: rep };
      })
      .sort((a, b) => b.reportRate - a.reportRate);

    const batchRows = batches.map((b) => {
      const members = mB.get(b.id) ?? 0;
      const rep = rB.get(b.id) ?? 0;
      return { batchId: b.id, name: b.name, members, reportsToday: rep, reportRate: rate(rep, members) };
    });

    const statusMap: Record<string, number> = {};
    for (const r of tasksByStatus) statusMap[r.status] = r._count;
    const roleMap: Record<string, number> = {};
    for (const r of users) roleMap[r.role] = r._count;

    return {
      date: todayStr,
      workingDay: await this.calendar.isWorkingDay(todayStr),
      users: { byRole: roleMap },
      tasks: { byStatus: statusMap, overdue, blocked },
      reports: { submittedToday: reportsToday, activeUsers, submissionRate: rate(reportsToday, activeUsers), lateToday },
      leaderboard,
      batches: batchRows,
    };
  }

  // ---------- LEAD: team progress + pending reviews + individuals ----------
  async leadOverview(me: RequestUser, teamId?: string) {
    if (me.role !== 'ADMIN' && me.role !== 'TEAM_LEAD') throw new ForbiddenException('Forbidden');
    const tid = teamId ?? me.teamId ?? undefined;
    if (me.role === 'TEAM_LEAD' && tid && tid !== me.teamId) {
      const led = await this.prisma.team.findFirst({ where: { id: tid, leadId: me.id }, select: { id: true } });
      if (!led) throw new ForbiddenException('Outside your teams');
    }
    const where: any = tid ? { teamId: tid } : {};
    const weekAgo = dayToDate(addDays(dayStr(), -7));
    const [byStatus, overdue, pending, members] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status'], where, _count: true }),
      this.prisma.task.count({ where: { ...where, dueDate: { lt: new Date() }, status: { not: 'DONE' } } }),
      this.prisma.task.findMany({
        where: { ...where, status: 'IN_REVIEW' }, take: 50, orderBy: { updatedAt: 'desc' },
        include: { owner: { select: { id: true, displayName: true } } },
      }),
      this.prisma.user.findMany({
        where: { ...(tid ? { teamId: tid } : {}), isActive: true, role: { not: 'ADMIN' } },
        select: { id: true, displayName: true, email: true }, orderBy: { displayName: 'asc' },
      }),
    ]);
    const ids = members.map((m) => m.id);
    const [perOwner, reps] = ids.length
      ? await Promise.all([
          this.prisma.task.groupBy({ by: ['ownerId', 'status'], where: { ownerId: { in: ids } }, _count: true }),
          this.prisma.dailyReport.groupBy({ by: ['userId'], where: { userId: { in: ids }, reportDate: { gte: weekAgo } }, _count: true }),
        ])
      : [[], []];
    const total = new Map<string, number>(), done = new Map<string, number>(), blocked = new Map<string, number>();
    for (const r of perOwner as any[]) {
      total.set(r.ownerId, (total.get(r.ownerId) ?? 0) + r._count);
      if (r.status === 'DONE') done.set(r.ownerId, r._count);
      if (r.status === 'BLOCKED') blocked.set(r.ownerId, r._count);
    }
    const repMap = new Map((reps as any[]).map((r) => [r.userId, r._count]));
    const perMember = members.map((m) => ({
      ...m,
      tasksTotal: total.get(m.id) ?? 0, tasksDone: done.get(m.id) ?? 0, tasksBlocked: blocked.get(m.id) ?? 0,
      doneRate: rate(done.get(m.id) ?? 0, total.get(m.id) ?? 0), reportsLast7: repMap.get(m.id) ?? 0,
    }));
    const statusMap: Record<string, number> = {};
    for (const r of byStatus) statusMap[r.status] = r._count;
    return { teamId: tid ?? null, tasksByStatus: statusMap, overdue, pendingReviews: pending, members: perMember };
  }

  // ---------- COORDINATOR: today's status of every member ----------
  async coordinatorToday(me: RequestUser, teamId?: string) {
    if (!['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(me.role)) throw new ForbiddenException('Forbidden');
    const tid = me.role === 'COORDINATOR' ? me.teamId ?? '__none__' : teamId ?? me.teamId ?? undefined;
    const todayStr = dayStr();
    const members = await this.prisma.user.findMany({
      where: { ...(tid ? { teamId: tid } : {}), isActive: true, role: { not: 'ADMIN' } },
      select: { id: true, displayName: true, email: true },
      orderBy: { displayName: 'asc' },
    });
    const ids = members.map((m) => m.id);
    const [perOwner, reports] = ids.length
      ? await Promise.all([
          this.prisma.task.groupBy({ by: ['ownerId', 'status'], where: { ownerId: { in: ids } }, _count: true }),
          this.prisma.dailyReport.findMany({ where: { userId: { in: ids }, reportDate: dayToDate(todayStr) }, select: { userId: true, isLate: true } }),
        ])
      : [[], []];
    const open = new Map<string, number>(), done = new Map<string, number>(), blocked = new Map<string, number>();
    for (const r of perOwner as any[]) {
      if (r.status === 'DONE') done.set(r.ownerId, r._count);
      else open.set(r.ownerId, (open.get(r.ownerId) ?? 0) + r._count);
      if (r.status === 'BLOCKED') blocked.set(r.ownerId, r._count);
    }
    const rep = new Map((reports as any[]).map((r) => [r.userId, r]));
    const rows = members.map((m) => ({
      ...m, openTasks: open.get(m.id) ?? 0, doneTasks: done.get(m.id) ?? 0, blockedTasks: blocked.get(m.id) ?? 0,
      reported: rep.has(m.id), late: rep.get(m.id)?.isLate ?? false,
    }));
    return { date: todayStr, workingDay: await this.calendar.isWorkingDay(todayStr), teamId: tid && tid !== '__none__' ? tid : null, members: rows };
  }

  // ---------- ATTENTION RADAR: who needs a human today, and why ----------
  async attention(me: RequestUser, teamId?: string): Promise<{ date: string; items: AttentionItem[] }> {
    if (!['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(me.role)) throw new ForbiddenException('Forbidden');
    const tid = me.role === 'COORDINATOR' ? me.teamId ?? '__none__' : teamId ?? (me.role === 'TEAM_LEAD' ? me.teamId ?? undefined : undefined);
    const today = dayStr();
    const now = new Date();
    const members = await this.prisma.user.findMany({
      where: { ...(tid ? { teamId: tid } : {}), isActive: true, role: { not: 'ADMIN' } },
      select: { id: true, displayName: true, createdAt: true },
    });
    if (!members.length) return { date: today, items: [] };
    const ids = members.map((m) => m.id);
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 3600_000);

    const [lastReports, overdue, blockedOld, stale, reviewWaiting, overdueIds] = await Promise.all([
      this.prisma.dailyReport.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _max: { reportDate: true } }),
      this.prisma.task.groupBy({ by: ['ownerId'], where: { ownerId: { in: ids }, status: { not: 'DONE' }, dueDate: { lt: now } }, _count: true }),
      this.prisma.task.groupBy({ by: ['ownerId'], where: { ownerId: { in: ids }, status: 'BLOCKED', updatedAt: { lt: dayAgo } }, _count: true }),
      this.prisma.task.groupBy({ by: ['ownerId'], where: { ownerId: { in: ids }, status: 'IN_PROGRESS', updatedAt: { lt: threeDaysAgo } }, _count: true }),
      this.prisma.task.groupBy({ by: ['ownerId'], where: { ownerId: { in: ids }, status: 'IN_REVIEW', updatedAt: { lt: dayAgo } }, _count: true }),
      this.prisma.task.findMany({
        where: { ownerId: { in: ids }, OR: [{ status: { not: 'DONE' }, dueDate: { lt: now } }, { status: 'BLOCKED', updatedAt: { lt: dayAgo } }] },
        select: { id: true, ownerId: true }, take: 400,
      }),
    ]);
    const last = new Map(lastReports.map((r) => [r.userId, r._max.reportDate ? r._max.reportDate.toISOString().slice(0, 10) : null]));
    const od = new Map(overdue.map((r) => [r.ownerId, r._count]));
    const bl = new Map(blockedOld.map((r) => [r.ownerId, r._count]));
    const st = new Map(stale.map((r) => [r.ownerId, r._count]));
    const rv = new Map(reviewWaiting.map((r) => [r.ownerId, r._count]));
    const tasksBy = new Map<string, string[]>();
    for (const t of overdueIds) tasksBy.set(t.ownerId, [...(tasksBy.get(t.ownerId) ?? []), t.id]);

    const deadlinePassed = await this.calendar.isLate(today, today, now);
    const items: AttentionItem[] = [];
    for (const m of members) {
      // working days they had to report but didn't (yesterday and earlier; today only after the deadline)
      const joined = dayStr(m.createdAt);
      const since = last.get(m.id);
      let missed = 0;
      const from = since ? addDays(since, 1) : joined;
      const to = deadlinePassed ? today : addDays(today, -1);
      for (let d = from, i = 0; d <= to && i < 45; d = addDays(d, 1), i++) {
        if (d >= joined && (await this.calendar.isWorkingDay(d))) missed++;
      }
      const reasons: string[] = [];
      let score = 0;
      if (missed >= 2) { reasons.push(`No daily report for ${missed} working days`); score += Math.min(missed, 5) * 2; }
      else if (missed === 1) { reasons.push('Missed yesterday\'s report'); score += 1; }
      const o = od.get(m.id) ?? 0, b = bl.get(m.id) ?? 0, s = st.get(m.id) ?? 0, r = rv.get(m.id) ?? 0;
      if (o) { reasons.push(`${o} overdue task${o > 1 ? 's' : ''}`); score += o * 2; }
      if (b) { reasons.push(`${b} task${b > 1 ? 's' : ''} blocked for over a day`); score += b * 2; }
      if (s) { reasons.push(`${s} task${s > 1 ? 's' : ''} in progress with no update for 3+ days`); score += s; }
      if (r && me.role !== 'COORDINATOR') { reasons.push(`${r} task${r > 1 ? 's' : ''} waiting for review over a day`); score += r; }
      if (!reasons.length) continue;
      items.push({
        userId: m.id, name: m.displayName, score, reasons, taskIds: (tasksBy.get(m.id) ?? []).slice(0, 5),
        severity: score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low',
      });
    }
    items.sort((a, b) => b.score - a.score);
    return { date: today, items: items.slice(0, 50) };
  }

  // ---------- ME: my tasks today + my progress + my training + streak ----------
  async mySummary(me: RequestUser) {
    const todayStr = dayStr();
    const { start: todayStart, end: todayEnd } = dayRange(todayStr);
    const weekAgo = dayToDate(addDays(todayStr, -7));
    const [byStatus, dueToday, overdue, plans, rep7, late7, recent] = await Promise.all([
      this.prisma.task.groupBy({ by: ['status'], where: { ownerId: me.id }, _count: true }),
      this.prisma.task.count({ where: { ownerId: me.id, status: { not: 'DONE' }, dueDate: { gte: todayStart, lt: todayEnd } } }),
      this.prisma.task.count({ where: { ownerId: me.id, status: { not: 'DONE' }, dueDate: { lt: new Date() } } }),
      me.batchId
        ? this.prisma.trainingPlan.findMany({ where: { batchId: me.batchId }, select: { id: true, title: true, _count: { select: { items: true } } } })
        : Promise.resolve([]),
      this.prisma.dailyReport.count({ where: { userId: me.id, reportDate: { gte: weekAgo } } }),
      this.prisma.dailyReport.count({ where: { userId: me.id, isLate: true, reportDate: { gte: weekAgo } } }),
      this.prisma.dailyReport.findMany({ where: { userId: me.id, reportDate: { gte: dayToDate(addDays(todayStr, -90)) } }, select: { reportDate: true } }),
    ]);
    const st = new Map(byStatus.map((r) => [r.status, r._count]));
    const open = byStatus.filter((r) => r.status !== 'DONE').reduce((s, r) => s + r._count, 0);

    const doneByPlan = plans.length
      ? await this.prisma.trainingProgress.findMany({
          where: { userId: me.id, isDone: true, item: { planId: { in: plans.map((p) => p.id) } } },
          select: { item: { select: { planId: true } } },
        })
      : [];
    const doneCount = new Map<string, number>();
    for (const d of doneByPlan) doneCount.set(d.item.planId, (doneCount.get(d.item.planId) ?? 0) + 1);
    const training = plans.map((p) => ({ planId: p.id, title: p.title, done: doneCount.get(p.id) ?? 0, total: p._count.items, progressPct: rate(doneCount.get(p.id) ?? 0, p._count.items) }));

    // Streak = consecutive WORKING days with a report. Today does not break it until the deadline has passed.
    const have = new Set(recent.map((r) => r.reportDate.toISOString().slice(0, 10)));
    let streak = 0;
    for (let d = todayStr, i = 0; i < 120; d = addDays(d, -1), i++) {
      if (!(await this.calendar.isWorkingDay(d))) continue;
      if (have.has(d)) streak++;
      else if (d === todayStr && !(await this.calendar.isLate(todayStr, todayStr))) continue;
      else break;
    }

    return {
      tasks: { open, dueToday, overdue, blocked: st.get('BLOCKED') ?? 0, inReview: st.get('IN_REVIEW') ?? 0 },
      training,
      reports: { last7: rep7, lateLast7: late7, streak, reportedToday: have.has(todayStr) },
    };
  }
}
