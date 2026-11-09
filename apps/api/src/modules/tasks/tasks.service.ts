import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../comms/notifications.service';
import { RealtimeGateway } from '../comms/realtime.gateway';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { canSeeTask } from '../../common/access';
import { FILE_SELECT, FileLinkService, LIVE_FILES } from '../../common/file-links.service';
import { AddCommentDto, ChangeStatusDto, CreateTaskDto, UpdateTaskDto } from './dto/tasks.dto';

type Status = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';

// Employee-allowed transitions; lead/admin can do any (with BLOCKED reason rule)
const EMPLOYEE_OK: Record<Status, Status[]> = {
  TODO: ['IN_PROGRESS', 'BLOCKED'],
  IN_PROGRESS: ['IN_REVIEW', 'BLOCKED', 'TODO'],
  IN_REVIEW: ['IN_PROGRESS', 'BLOCKED'],
  BLOCKED: ['IN_PROGRESS', 'TODO'],
  DONE: [],
};

type TaskLike = { ownerId: string; teamId: string | null; collaborators?: Array<{ userId: string }> };

const canSee = canSeeTask;

function plusDays(d: Date, n: number) {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Month arithmetic that clamps to the last day (Jan 31 + 1 month = Feb 28/29, never Mar 3). */
function plusMonths(d: Date, n: number) {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return new Date(Date.UTC(y, m, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/** Materialized occurrences (max 60) for the calendar/list, so every occurrence behaves like a normal task. */
function occurrenceDates(start: Date, recurrence: string, until: Date): Date[] {
  if (recurrence === 'NONE') return [];
  const out = [new Date(start)];
  for (let i = 1; i < 60; i++) {
    const next = recurrence === 'DAILY' ? plusDays(start, i) : recurrence === 'WEEKLY' ? plusDays(start, i * 7) : plusMonths(start, i);
    if (next > until) break;
    out.push(next);
  }
  return out;
}

/**
 * Planning access: admin anywhere; team lead and coordinator only inside their own team
 * (staff with no team can manage nothing). Coordinators plan/assign; only leads approve Done.
 */
function plansOwnTeam(me: RequestUser, teamId: string | null) {
  if (me.role === 'ADMIN') return true;
  if (me.role !== 'TEAM_LEAD' && me.role !== 'COORDINATOR') return false;
  return !!me.teamId && me.teamId === teamId;
}

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private realtime: RealtimeGateway,
    private links: FileLinkService,
  ) {}

  async list(
    me: RequestUser,
    q: { status?: string; ownerId?: string; teamId?: string; projectId?: string; page?: string; limit?: string; search?: string; overdue?: string },
  ) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.ownerId) where.ownerId = q.ownerId;
    if (q.teamId) where.teamId = q.teamId;
    if (q.projectId) where.projectId = q.projectId;
    if (q.search?.trim()) where.title = { contains: q.search.trim(), mode: 'insensitive' };
    if (q.overdue === 'true') {
      where.dueDate = { lt: new Date() };
      where.status = { not: 'DONE' };
    }

    if (me.role === 'EMPLOYEE') {
      const collab = await this.prisma.taskCollaborator.findMany({ where: { userId: me.id }, select: { taskId: true } });
      const ids = collab.map((c) => c.taskId);
      where.OR = [{ ownerId: me.id }, ...(ids.length ? [{ id: { in: ids } }] : [])];
    } else if (me.role === 'COORDINATOR') {
      // Hard-scoped: the ?teamId= query can no longer be used to peek at other teams.
      if (!me.teamId) return { data: [], meta: { total: 0, page, limit, totalPages: 1 } };
      where.teamId = me.teamId;
    }
    const [total, rows] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { owner: { select: { id: true, displayName: true } }, collaborators: { select: { userId: true } }, project: { select: { id: true, name: true } } },
      }),
    ]);
    return { data: rows, meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  async get(me: RequestUser, id: string) {
    const t = await this.prisma.task.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, displayName: true, email: true } },
        project: { select: { id: true, name: true } },
        collaborators: { include: { user: { select: { id: true, displayName: true } } } },
        comments: { include: { author: { select: { id: true, displayName: true } }, files: LIVE_FILES }, orderBy: { createdAt: 'asc' } },
        files: { where: { deletedAt: null, commentId: null }, select: FILE_SELECT, orderBy: { createdAt: 'asc' } },
        activities: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!t) throw new NotFoundException('Task not found');
    if (!canSee(me, { ownerId: t.ownerId, teamId: t.teamId, collaborators: t.collaborators as any })) throw new ForbiddenException('Forbidden');
    return t;
  }

  async create(me: RequestUser, dto: CreateTaskDto, ip?: string) {
    if (!['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(me.role)) throw new ForbiddenException('Only leads, coordinators and admins assign tasks');
    if (!plansOwnTeam(me, dto.teamId)) throw new ForbiddenException('You can assign tasks only within your own team');

    const [owner, team] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: dto.ownerId }, select: { id: true, isActive: true, teamId: true } }),
      this.prisma.team.findUnique({ where: { id: dto.teamId }, select: { id: true } }),
    ]);
    if (!owner || !owner.isActive) throw new BadRequestException('Invalid owner');
    if (!team) throw new BadRequestException('Invalid team');
    if (owner.teamId !== dto.teamId) throw new BadRequestException('The assignee does not belong to that team');

    let collaboratorIds = [...new Set(dto.collaboratorIds ?? [])].filter((x) => x !== dto.ownerId);
    if (collaboratorIds.length) {
      const ok = await this.prisma.user.findMany({ where: { id: { in: collaboratorIds }, isActive: true }, select: { id: true } });
      collaboratorIds = ok.map((u) => u.id);
    }
    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: dto.projectId }, select: { teamId: true } });
      if (!project) throw new BadRequestException('Invalid projectId');
      if (project.teamId && project.teamId !== dto.teamId) throw new BadRequestException('That project belongs to another team');
    }

    const recurrence = dto.recurrence ?? 'NONE';
    const firstDue = dto.dueDate ? new Date(dto.dueDate) : null;
    if (recurrence !== 'NONE' && !firstDue) throw new BadRequestException('Recurring tasks need a due date');
    let until: Date | null = null;
    if (recurrence !== 'NONE' && firstDue) {
      const requested = dto.recurrenceUntil ? new Date(dto.recurrenceUntil) : plusDays(firstDue, 30);
      if (requested < firstDue) throw new BadRequestException('Repeat-until must be on or after the due date');
      until = new Date(Math.min(requested.getTime(), plusDays(firstDue, 90).getTime()));
    }
    const dates = recurrence !== 'NONE' && firstDue ? occurrenceDates(firstDue, recurrence, until!) : [];

    const fields = {
      title: dto.title.trim(),
      description: dto.description ?? null,
      goalId: dto.goalId ?? null,
      projectId: dto.projectId ?? null,
      ownerId: dto.ownerId,
      teamId: dto.teamId,
      batchId: dto.batchId ?? null,
      priority: (dto.priority ?? 'MEDIUM') as any,
      estimatedHours: dto.estimatedHours ?? null,
      createdById: me.id,
      recurrence,
      recurrenceUntil: until,
    };

    const t = await this.prisma.$transaction(async (tx) => {
      const first = await tx.task.create({
        data: {
          ...fields,
          dueDate: firstDue,
          collaborators: collaboratorIds.length ? { create: collaboratorIds.map((userId) => ({ userId })) } : undefined,
          activities: { create: { actorId: me.id, action: 'CREATED', toStatus: 'TODO' } },
        },
      });
      if (dates.length > 1) {
        await tx.task.update({ where: { id: first.id }, data: { seriesId: first.id } });
        await tx.task.createMany({
          data: dates.slice(1).map((dueDate) => ({ ...fields, dueDate, seriesId: first.id })),
        });
        first.seriesId = first.id;
      }
      return first;
    });
    await this.audit.log({
      actorId: me.id, action: 'TASK_CREATE', entity: 'task', entityId: t.id,
      metadata: { ownerId: dto.ownerId, teamId: dto.teamId, recurrence, occurrences: recurrence === 'NONE' ? 1 : dates.length }, ip,
    });
    await this.notifications.notify([dto.ownerId, ...collaboratorIds].filter((x) => x !== me.id), {
      type: 'TASK_ASSIGNED', title: `New task: ${t.title}`,
      body: `Assigned by ${me.displayName}${recurrence !== 'NONE' ? ` · repeats ${recurrence.toLowerCase()} (${dates.length} occurrences)` : ''}`,
      link: `/tasks/${t.id}`,
    });
    this.realtime.emitTask(t.id, t.teamId, 'task:created', { id: t.id, title: t.title, status: t.status });
    return t;
  }

  /** Stops a recurring series: removes future occurrences and detaches the current one. */
  async stopSeries(me: RequestUser, id: string, ip?: string) {
    const t = await this.prisma.task.findUnique({
      where: { id }, select: { id: true, seriesId: true, teamId: true, dueDate: true, recurrence: true },
    });
    if (!t) throw new NotFoundException('Task not found');
    if (!plansOwnTeam(me, t.teamId)) throw new ForbiddenException('Only the team lead, coordinator or admin can stop a repeat');
    if (!t.seriesId || t.recurrence === 'NONE') throw new BadRequestException('This task does not repeat');
    const removed = t.dueDate
      ? await this.prisma.task.deleteMany({
          where: { seriesId: t.seriesId, dueDate: { gt: t.dueDate }, status: { not: 'DONE' }, id: { not: t.id } },
        })
      : { count: 0 };
    await this.prisma.task.update({ where: { id }, data: { recurrence: 'NONE', recurrenceUntil: null } });
    await this.audit.log({ actorId: me.id, action: 'TASK_SERIES_STOP', entity: 'task', entityId: id, metadata: { removed: removed.count }, ip });
    this.realtime.emitTask(t.id, t.teamId, 'task:updated', { id: t.id, stopsRepeat: true });
    return { ok: true, removed: removed.count };
  }

  async update(me: RequestUser, id: string, dto: UpdateTaskDto, ip?: string) {
    const t = await this.prisma.task.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Task not found');

    if (me.role === 'EMPLOYEE') {
      if (t.ownerId !== me.id) throw new ForbiddenException('Forbidden');
      // Interns may add notes to their own task but cannot move deadlines, priority, scope or owner.
      const restricted = ['title', 'priority', 'dueDate', 'estimatedHours', 'ownerId'] as const;
      if (restricted.some((k) => (dto as any)[k] !== undefined)) throw new ForbiddenException('Only your lead or coordinator can change title, priority, due date or assignee');
    } else if (!plansOwnTeam(me, t.teamId)) {
      throw new ForbiddenException('Outside your team');
    }

    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({ where: { id: dto.projectId }, select: { teamId: true } });
      if (!project) throw new BadRequestException('Invalid projectId');
      if (project.teamId && project.teamId !== t.teamId) throw new BadRequestException('That project belongs to another team');
    }

    let newOwner: { id: string; teamId: string | null } | null = null;
    if (dto.ownerId && dto.ownerId !== t.ownerId) {
      const o = await this.prisma.user.findUnique({ where: { id: dto.ownerId }, select: { id: true, isActive: true, teamId: true } });
      if (!o || !o.isActive) throw new BadRequestException('Invalid owner');
      if (o.teamId !== t.teamId) throw new BadRequestException('The new assignee is not in this task\'s team');
      newOwner = o;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.task.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.priority !== undefined ? { priority: dto.priority as any } : {}),
          ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
          ...(dto.estimatedHours !== undefined ? { estimatedHours: dto.estimatedHours } : {}),
          ...(dto.projectId !== undefined ? { projectId: dto.projectId } : {}),
          ...(newOwner ? { ownerId: newOwner.id } : {}),
        },
      });
      await tx.taskActivity.create({ data: { taskId: id, actorId: me.id, action: newOwner ? 'REASSIGNED' : 'UPDATED' } });
      return u;
    });
    await this.audit.log({ actorId: me.id, action: 'TASK_UPDATE', entity: 'task', entityId: id, metadata: dto as any, ip });
    if (newOwner) {
      await this.notifications.notify([newOwner.id], { type: 'TASK_ASSIGNED', title: `Task assigned to you: ${updated.title}`, body: `Reassigned by ${me.displayName}`, link: `/tasks/${id}` });
      await this.notifications.notify([t.ownerId], { type: 'TASK_STATUS_CHANGED', title: `Task reassigned: ${updated.title}`, body: `${me.displayName} moved this task to someone else`, link: `/tasks/${id}` });
    }
    this.realtime.emitTask(id, t.teamId, 'task:updated', { id, title: updated.title, status: updated.status });
    return updated;
  }

  async changeStatus(me: RequestUser, id: string, dto: ChangeStatusDto, ip?: string) {
    const t = await this.prisma.task.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Task not found');
    const from = t.status as Status;
    const to = dto.status;
    if (from === to) throw new BadRequestException('Task is already in that status');

    const isOwner = t.ownerId === me.id;
    const isLead = me.role === 'ADMIN' || (me.role === 'TEAM_LEAD' && plansOwnTeam(me, t.teamId));
    // Coordinators plan and unblock inside their team, but never approve/reopen Done work.
    const isCoordinator = me.role === 'COORDINATOR' && plansOwnTeam(me, t.teamId);

    if (me.role === 'EMPLOYEE' && !isOwner) throw new ForbiddenException('Only the owner can update status');
    if (me.role === 'TEAM_LEAD' && !isLead && !isOwner) throw new ForbiddenException('Outside your team');
    if (me.role === 'COORDINATOR' && !isCoordinator && !isOwner) throw new ForbiddenException('Outside your team');

    // Four-eyes rule: you cannot approve your own work (admins excepted so a one-person team is never stuck).
    if (to === 'DONE' && !isLead) throw new ForbiddenException('Only a team lead can mark Done (review approval)');
    if (to === 'DONE' && isOwner && me.role !== 'ADMIN') throw new ForbiddenException('Someone else must approve your own task');
    if (from === 'DONE' && !isLead) throw new ForbiddenException('Only a team lead can reopen a Done task');

    if (!isLead && !isCoordinator) {
      const allowed = EMPLOYEE_OK[from] ?? [];
      if (!allowed.includes(to)) throw new BadRequestException(`Transition ${from} -> ${to} not allowed`);
    }
    if (to === 'BLOCKED' && !dto.blockedReason?.trim()) throw new BadRequestException('blockedReason is required when status is BLOCKED');

    // Compare-and-set: if two people change the same task at once, the second one gets a clear conflict.
    const updated = await this.prisma.$transaction(async (tx) => {
      const r = await tx.task.updateMany({
        where: { id, status: from as any },
        data: {
          status: to as any,
          blockedReason: to === 'BLOCKED' ? dto.blockedReason!.trim() : null,
          reviewNote: dto.reviewNote ?? t.reviewNote,
          completedAt: to === 'DONE' ? new Date() : from === 'DONE' ? null : t.completedAt,
        },
      });
      if (r.count !== 1) throw new ConflictException('This task was just changed by someone else. Refresh and try again.');
      await tx.taskActivity.create({
        data: { taskId: id, actorId: me.id, action: 'STATUS_CHANGED', fromStatus: from as any, toStatus: to as any, detail: { blockedReason: dto.blockedReason ?? null, reviewNote: dto.reviewNote ?? null } as any },
      });
      return tx.task.findUniqueOrThrow({ where: { id } });
    });
    await this.audit.log({ actorId: me.id, action: 'TASK_STATUS_CHANGE', entity: 'task', entityId: id, metadata: { from, to }, ip });
    this.realtime.emitTask(id, t.teamId, 'task:updated', { id, from, to, title: t.title, status: to });

    // Notifications
    const link = `/tasks/${id}`;
    if (to === 'BLOCKED') {
      const staff = await this.prisma.user.findMany({
        where: { teamId: t.teamId, isActive: true, role: { in: ['TEAM_LEAD', 'COORDINATOR'] } }, select: { id: true },
      });
      await this.notifications.notify(staff.map((s) => s.id).filter((x) => x !== me.id), { type: 'TASK_BLOCKED', title: `Blocked: ${t.title}`, body: dto.blockedReason ?? '', link });
    } else if (to === 'IN_REVIEW') {
      const leads = await this.prisma.user.findMany({
        where: { teamId: t.teamId, isActive: true, role: { in: ['TEAM_LEAD', 'ADMIN'] } }, select: { id: true },
      });
      await this.notifications.notify(leads.map((s) => s.id).filter((x) => x !== me.id), { type: 'REVIEW_REQUESTED', title: `Review: ${t.title}`, body: `${me.displayName} submitted this for review`, link });
    } else if (!isOwner && to === 'DONE') {
      await this.notifications.notify([t.ownerId], { type: 'REVIEW_DECISION', title: `Approved: ${t.title}`, body: dto.reviewNote ?? undefined, link });
    } else if (!isOwner && from === 'IN_REVIEW' && (to === 'IN_PROGRESS' || to === 'TODO')) {
      // Previously the intern was never told their work was sent back.
      await this.notifications.notify([t.ownerId], { type: 'REVIEW_DECISION', title: `Sent back: ${t.title}`, body: dto.reviewNote ?? 'Your lead asked for changes.', link });
    } else if (!isOwner && from === 'DONE') {
      await this.notifications.notify([t.ownerId], { type: 'TASK_STATUS_CHANGED', title: `Reopened: ${t.title}`, body: dto.reviewNote ?? undefined, link });
    }
    return updated;
  }

  async comment(me: RequestUser, id: string, dto: AddCommentDto) {
    const t = await this.prisma.task.findUnique({ where: { id }, include: { collaborators: true } });
    if (!t) throw new NotFoundException('Task not found');
    if (!canSee(me, { ownerId: t.ownerId, teamId: t.teamId, collaborators: t.collaborators })) throw new ForbiddenException('Forbidden');
    const body = (dto.body ?? '').trim();
    if (!body && !dto.fileIds?.length) throw new BadRequestException('Write a comment or attach a file');
    const c = await this.prisma.$transaction(async (tx) => {
      const created = await tx.taskComment.create({ data: { taskId: id, authorId: me.id, body } });
      await this.links.claim(tx, me.id, dto.fileIds, { context: 'COMMENT', scopeId: id }, { commentId: created.id, taskId: id });
      return tx.taskComment.findUniqueOrThrow({ where: { id: created.id }, include: { author: { select: { id: true, displayName: true } }, files: LIVE_FILES } });
    });
    // Full text only to people who can open the task.
    this.realtime.emitTask(id, t.teamId, 'comment:added', { id: c.id, taskId: id, body: c.body, authorId: me.id, createdAt: c.createdAt });
    const audience = [t.ownerId, ...t.collaborators.map((x) => x.userId)].filter((x) => x !== me.id);
    await this.notifications.notify(audience, {
      type: 'TASK_COMMENT', title: `New comment: ${t.title}`,
      body: `${me.displayName}: ${body ? body.slice(0, 200) : `sent ${c.files.length} file${c.files.length === 1 ? '' : 's'}`}`, link: `/tasks/${id}`,
    });
    return c;
  }

  async removeAttachment(me: RequestUser, taskId: string, fileId: string, ip?: string) {
    const f = await this.prisma.fileAsset.findFirst({ where: { id: fileId, taskId, deletedAt: null } });
    if (!f) throw new NotFoundException('Attachment not found');
    const t = await this.prisma.task.findUnique({ where: { id: taskId }, select: { teamId: true } });
    if (f.uploaderId !== me.id && !plansOwnTeam(me, t?.teamId ?? null)) throw new ForbiddenException('Only the uploader, team lead or coordinator can remove this');
    await this.prisma.fileAsset.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
    await this.audit.log({ actorId: me.id, action: 'FILE_DELETE', entity: 'task', entityId: taskId, metadata: { file: f.name }, ip });
    return { ok: true };
  }
}
