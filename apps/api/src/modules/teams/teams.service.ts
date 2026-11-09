import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserCacheService } from '../../common/user-cache.service';
import { CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';

@Injectable()
export class TeamsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private cache: UserCacheService) {}

  /** A team's lead/coordinator must actually belong to that team, otherwise team-scoped permissions would lock them out. */
  private async syncStaff(teamId: string, ids: Array<string | null | undefined>) {
    const staff = ids.filter((x): x is string => Boolean(x));
    if (!staff.length) return;
    await this.prisma.user.updateMany({ where: { id: { in: staff } }, data: { teamId } });
    staff.forEach((id) => this.cache.invalidate(id));
  }

  list() {
    return this.prisma.team.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { members: true } },
        hr: { select: { id: true, displayName: true, email: true } },
      },
    });
  }

  async get(id: string, viewerRole: string = 'ADMIN') {
    const staff = viewerRole !== 'EMPLOYEE';
    const t = await this.prisma.team.findUnique({
      where: { id },
      include: {
        members: { select: { id: true, displayName: true, email: staff, role: true, isActive: true } },
        lead: { select: { id: true, displayName: true, email: staff } },
        coordinator: { select: { id: true, displayName: true, email: staff } },
        hr: { select: { id: true, displayName: true, email: staff } },
      },
    });
    if (!t) throw new NotFoundException('Team not found');
    return t;
  }

  async create(meId: string, dto: CreateTeamDto, ip?: string) {
    const exists = await this.prisma.team.findUnique({ where: { name: dto.name } });
    if (exists) throw new BadRequestException('Team name already exists');
    if (dto.leadId) await this.assertUser(dto.leadId);
    if (dto.coordinatorId) await this.assertUser(dto.coordinatorId);
    if (dto.hrId) await this.assertUser(dto.hrId);
    const t = await this.prisma.team.create({
      data: { name: dto.name, description: dto.description ?? null, leadId: dto.leadId ?? null, coordinatorId: dto.coordinatorId ?? null, hrId: dto.hrId ?? null, createdById: meId },
    });
    await this.syncStaff(t.id, [dto.leadId, dto.coordinatorId, dto.hrId]);
    await this.audit.log({ actorId: meId, action: 'TEAM_CREATE', entity: 'team', entityId: t.id, ip });
    return t;
  }

  async update(meId: string, id: string, dto: UpdateTeamDto, ip?: string) {
    await this.get(id);
    if (dto.leadId) await this.assertUser(dto.leadId);
    if (dto.coordinatorId) await this.assertUser(dto.coordinatorId);
    if (dto.hrId) await this.assertUser(dto.hrId);
    if (dto.name) {
      const clash = await this.prisma.team.findFirst({ where: { name: dto.name, id: { not: id } }, select: { id: true } });
      if (clash) throw new BadRequestException('Another team already uses that name');
    }
    const t = await this.prisma.team.update({ where: { id }, data: { ...dto } });
    await this.syncStaff(id, [dto.leadId, dto.coordinatorId, dto.hrId]);
    await this.audit.log({ actorId: meId, action: 'TEAM_UPDATE', entity: 'team', entityId: id, metadata: dto as any, ip });
    return t;
  }

  private async assertUser(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u || !u.isActive) throw new BadRequestException('Invalid member user');
  }
}
