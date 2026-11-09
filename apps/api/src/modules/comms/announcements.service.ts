import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { CreateAnnouncementDto } from './dto/comms.dto';
import { NotificationsService } from './notifications.service';
import { FileLinkService, LIVE_FILES } from '../../common/file-links.service';

@Injectable()
export class AnnouncementsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
    private links: FileLinkService,
  ) {}

  async create(me: RequestUser, dto: CreateAnnouncementDto, ip?: string) {
    const scope = dto.scope ?? 'COMPANY';
    if (scope === 'COMPANY' && me.role !== 'ADMIN') throw new ForbiddenException('Company announcements are admin-only');
    if ((scope === 'TEAM' || scope === 'BATCH') && !['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(me.role))
      throw new ForbiddenException('Only leads, coordinators and admins post team announcements');
    if (scope === 'BATCH' && me.role === 'COORDINATOR')
      throw new ForbiddenException('Coordinators can post to their own team only');

    if (scope === 'TEAM') {
      if (!dto.teamId && me.teamId) dto.teamId = me.teamId;
      if (!dto.teamId && me.role === 'TEAM_LEAD') {
        const led = await this.prisma.team.findFirst({ where: { leadId: me.id }, select: { id: true } });
        if (led) dto.teamId = led.id;
      }
      if (!dto.teamId) throw new BadRequestException('teamId required for TEAM scope');
      if ((me.role === 'TEAM_LEAD' || me.role === 'COORDINATOR') && dto.teamId !== me.teamId) {
        // A lead may still post to a team they lead even if their own teamId was not synced.
        const led = me.role === 'TEAM_LEAD' ? await this.prisma.team.findFirst({ where: { id: dto.teamId, leadId: me.id }, select: { id: true } }) : null;
        if (!led) throw new ForbiddenException('Outside your team');
      }
    }
    if (scope === 'BATCH') {
      if (!dto.batchId) throw new BadRequestException('batchId required for BATCH scope');
      const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId }, select: { leadId: true, coordinatorId: true } });
      if (!batch) throw new BadRequestException('Invalid batchId');
      // A lead may only address batches they actually lead (or batches whose trainees are in their team).
      if (me.role === 'TEAM_LEAD' && batch.leadId !== me.id) {
        const inTeam = me.teamId ? await this.prisma.user.count({ where: { batchId: dto.batchId, teamId: me.teamId } }) : 0;
        if (!inTeam) throw new ForbiddenException('You can only post to batches you lead');
      }
    }

    const a = await this.prisma.$transaction(async (tx) => {
      const created = await tx.announcement.create({
        data: {
          title: dto.title.trim(), body: dto.body.trim(), scope: scope as any,
          teamId: scope === 'TEAM' ? dto.teamId ?? null : null,
          batchId: scope === 'BATCH' ? dto.batchId ?? null : null,
          createdById: me.id,
        },
      });
      await this.links.claim(tx, me.id, dto.fileIds, { context: 'ANNOUNCEMENT' }, { announcementId: created.id });
      return created;
    });

    const scopeWhere: any = { isActive: true };
    if (scope === 'TEAM') scopeWhere.teamId = dto.teamId;
    if (scope === 'BATCH') scopeWhere.batchId = dto.batchId;
    const ids = (await this.prisma.user.findMany({ where: scopeWhere, select: { id: true } })).map((u) => u.id);
    await this.notifications.notify(ids.filter((id) => id !== me.id), {
      type: 'ANNOUNCEMENT', title: dto.title.trim(), body: dto.body.trim().slice(0, 300), link: '/announcements',
    });

    await this.audit.log({ actorId: me.id, action: 'ANNOUNCEMENT_CREATE', entity: 'announcement', entityId: a.id, ip });
    return a;
  }

  feed(me: RequestUser) {
    if (me.role === 'ADMIN') return this.prisma.announcement.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { files: LIVE_FILES } });
    return this.prisma.announcement.findMany({
      where: {
        OR: [{ scope: 'COMPANY' }, ...(me.teamId ? [{ scope: 'TEAM' as any, teamId: me.teamId }] : []), ...(me.batchId ? [{ scope: 'BATCH' as any, batchId: me.batchId }] : [])],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { files: LIVE_FILES },
    });
  }

  async remove(me: RequestUser, id: string, ip?: string) {
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Not found');
    if (me.role !== 'ADMIN' && a.createdById !== me.id) throw new ForbiddenException('Forbidden');
    await this.prisma.fileAsset.updateMany({ where: { announcementId: id }, data: { deletedAt: new Date() } });
    await this.prisma.announcement.delete({ where: { id } });
    await this.audit.log({ actorId: me.id, action: 'ANNOUNCEMENT_DELETE', entity: 'announcement', entityId: id, ip });
    return { ok: true };
  }
}
