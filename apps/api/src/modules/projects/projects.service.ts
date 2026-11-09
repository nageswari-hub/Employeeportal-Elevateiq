import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CreateProjectDto, UpdateProjectDto } from './dto/projects.dto';

const PLANNERS = ['ADMIN', 'TEAM_LEAD', 'COORDINATOR'];

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Employees see their team/batch projects; coordinators their team; leads and admins everything. */
  private scope(me: RequestUser) {
    if (me.role === 'ADMIN' || me.role === 'TEAM_LEAD') return {};
    const or: any[] = [{ ownerId: me.id }, { id: '__none__' }];
    if (me.teamId) or.push({ teamId: me.teamId });
    if (me.batchId) or.push({ batchId: me.batchId });
    return { OR: or };
  }

  private wire(p: any, counts?: { total: number; done: number }) {
    const total = counts?.total ?? 0;
    const done = counts?.done ?? 0;
    return { ...p, taskCount: total, doneCount: done, progress: total ? Math.round((done / total) * 100) : 0 };
  }

  async list(me: RequestUser) {
    const projects = await this.prisma.project.findMany({
      where: this.scope(me), orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200,
      include: {
        team: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true } },
        owner: { select: { id: true, displayName: true } },
      },
    });
    if (!projects.length) return [];
    const grouped = await this.prisma.task.groupBy({
      by: ['projectId', 'status'], where: { projectId: { in: projects.map((p) => p.id) } }, _count: { _all: true },
    });
    const counts = new Map<string, { total: number; done: number }>();
    for (const g of grouped) {
      if (!g.projectId) continue;
      const c = counts.get(g.projectId) ?? { total: 0, done: 0 };
      c.total += g._count._all;
      if (g.status === 'DONE') c.done += g._count._all;
      counts.set(g.projectId, c);
    }
    return projects.map((p) => this.wire(p, counts.get(p.id)));
  }

  private async mustSee(me: RequestUser, id: string) {
    const p = await this.prisma.project.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true } },
        owner: { select: { id: true, displayName: true } },
        tasks: {
          orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }], take: 500,
          include: { owner: { select: { id: true, displayName: true } } },
        },
      },
    });
    if (!p) throw new NotFoundException('Project not found');
    const allowed =
      me.role === 'ADMIN' || me.role === 'TEAM_LEAD' || p.ownerId === me.id ||
      (me.role === 'COORDINATOR' && !!me.teamId && p.teamId === me.teamId) ||
      (!!me.teamId && p.teamId === me.teamId) || (!!me.batchId && p.batchId === me.batchId);
    if (!allowed) throw new ForbiddenException('Forbidden');
    return p;
  }

  async get(me: RequestUser, id: string) {
    const p = await this.mustSee(me, id);
    const done = p.tasks.filter((t) => t.status === 'DONE').length;
    return this.wire(p, { total: p.tasks.length, done });
  }

  async create(me: RequestUser, dto: CreateProjectDto, ip?: string) {
    if (!PLANNERS.includes(me.role)) throw new ForbiddenException('Only leads, coordinators and admins create projects');
    const teamId = dto.teamId ?? me.teamId ?? null;
    if (!teamId) throw new BadRequestException('teamId required');
    if (me.role !== 'ADMIN' && (!me.teamId || teamId !== me.teamId)) throw new ForbiddenException('You can create projects for your own team only');
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
    if (!team) throw new BadRequestException('Invalid teamId');
    if (dto.ownerId) {
      const owner = await this.prisma.user.findFirst({ where: { id: dto.ownerId, isActive: true }, select: { teamId: true } });
      if (!owner) throw new BadRequestException('Invalid owner');
      if (owner.teamId !== teamId) throw new BadRequestException('The owner is not in this team');
    }
    if (dto.startDate && dto.dueDate && new Date(dto.dueDate) < new Date(dto.startDate)) throw new BadRequestException('Due date must be after the start date');
    const p = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        description: dto.description ?? null,
        teamId,
        batchId: dto.batchId ?? null,
        ownerId: dto.ownerId ?? null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        createdById: me.id,
      },
    });
    await this.audit.log({ actorId: me.id, action: 'PROJECT_CREATE', entity: 'project', entityId: p.id, ip });
    return this.wire(p);
  }

  async update(me: RequestUser, id: string, dto: UpdateProjectDto, ip?: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    if (!PLANNERS.includes(me.role)) throw new ForbiddenException('Forbidden');
    if (me.role !== 'ADMIN' && (!me.teamId || p.teamId !== me.teamId)) throw new ForbiddenException('Outside your team');
    if (dto.ownerId) {
      const owner = await this.prisma.user.findFirst({ where: { id: dto.ownerId, isActive: true }, select: { teamId: true } });
      if (!owner) throw new BadRequestException('Invalid owner');
      if (p.teamId && owner.teamId !== p.teamId) throw new BadRequestException('The owner is not in this team');
    }
    const start = dto.startDate ? new Date(dto.startDate) : p.startDate;
    const due = dto.dueDate ? new Date(dto.dueDate) : p.dueDate;
    if (start && due && due < start) throw new BadRequestException('Due date must be after the start date');
    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.status !== undefined ? { status: dto.status as any } : {}),
        ...(dto.ownerId !== undefined ? { ownerId: dto.ownerId } : {}),
        ...(dto.startDate !== undefined ? { startDate: start } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: due } : {}),
      },
    });
    await this.audit.log({ actorId: me.id, action: 'PROJECT_UPDATE', entity: 'project', entityId: id, metadata: dto as any, ip });
    return this.wire(updated);
  }

  async remove(me: RequestUser, id: string, ip?: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Project not found');
    if (!PLANNERS.includes(me.role)) throw new ForbiddenException('Forbidden');
    if (me.role !== 'ADMIN' && (!me.teamId || p.teamId !== me.teamId)) throw new ForbiddenException('Outside your team');
    await this.prisma.project.delete({ where: { id } });
    await this.audit.log({ actorId: me.id, action: 'PROJECT_DELETE', entity: 'project', entityId: id, ip });
    return { ok: true };
  }
}
