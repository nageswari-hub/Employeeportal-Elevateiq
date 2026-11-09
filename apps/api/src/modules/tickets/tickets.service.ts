import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../comms/notifications.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { AddTicketMessageDto, CreateTicketDto, UpdateTicketDto } from './dto/tickets.dto';

const TICKET_INCLUDE = {
  requester: { select: { id: true, displayName: true, role: true } },
  assignee: { select: { id: true, displayName: true } },
  resolvedBy: { select: { id: true, displayName: true } },
  team: { select: { id: true, name: true } },
} as const;

@Injectable()
export class TicketsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private notifications: NotificationsService,
  ) {}

  private where(me: RequestUser) {
    if (me.role === 'ADMIN') return {};
    const or: any[] = [{ requesterId: me.id }, { assigneeId: me.id }];
    if ((me.role === 'TEAM_LEAD' || me.role === 'COORDINATOR') && me.teamId) or.push({ teamId: me.teamId });
    return { OR: or };
  }

  list(me: RequestUser, q: { status?: string }) {
    const where: any = this.where(me);
    if (q.status) where.status = q.status;
    return this.prisma.ticket.findMany({
      where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 300, include: TICKET_INCLUDE,
    });
  }

  private async mustSee(me: RequestUser, id: string) {
    const t = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ...TICKET_INCLUDE,
        messages: { orderBy: { createdAt: 'asc' }, take: 500, include: { author: { select: { id: true, displayName: true, role: true } } } },
      },
    });
    if (!t) throw new NotFoundException('Ticket not found');
    const allowed =
      me.role === 'ADMIN' || t.requesterId === me.id || t.assigneeId === me.id ||
      ((me.role === 'TEAM_LEAD' || me.role === 'COORDINATOR') && !!me.teamId && t.teamId === me.teamId);
    if (!allowed) throw new ForbiddenException('Forbidden');
    return t;
  }

  get(me: RequestUser, id: string) {
    return this.mustSee(me, id);
  }

  async create(me: RequestUser, dto: CreateTicketDto, ip?: string) {
    let assigneeId: string | null = null;
    let escalated = Boolean(dto.escalateToAdmin);

    if (me.role === 'ADMIN') {
      assigneeId = null;
    } else if (escalated) {
      assigneeId = (await this.prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? null;
    } else {
      const team = me.teamId
        ? await this.prisma.team.findUnique({ where: { id: me.teamId }, select: { leadId: true, coordinatorId: true } })
        : null;
      if (me.role === 'TEAM_LEAD') {
        // A lead's own issue goes to an admin (and from there back to the team if needed).
        escalated = true;
        assigneeId = (await this.prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? null;
      } else {
        assigneeId = team?.leadId ?? team?.coordinatorId ?? null;
      }
    }

    const t = await this.prisma.ticket.create({
      data: {
        subject: dto.subject.trim(),
        description: dto.description.trim(),
        category: (dto.category ?? 'OTHER') as any,
        priority: (escalated ? 'URGENT' : dto.priority ?? 'MEDIUM') as any,
        escalated,
        requesterId: me.id,
        assigneeId,
        teamId: me.teamId,
      },
      include: TICKET_INCLUDE,
    });
    await this.audit.log({ actorId: me.id, action: 'TICKET_CREATE', entity: 'ticket', entityId: t.id, metadata: { escalated, assigneeId }, ip });
    if (assigneeId && assigneeId !== me.id) {
      await this.notifications.notify([assigneeId], {
        type: 'TICKET',
        title: `${escalated ? 'Escalated ticket' : 'New ticket'}: ${t.subject}`,
        body: `Raised by ${me.displayName}`,
        link: `/tickets/${t.id}`,
      });
    }
    return t;
  }

  async update(me: RequestUser, id: string, dto: UpdateTicketDto, ip?: string) {
    const t = await this.mustSee(me, id);
    const isStaff =
      me.role === 'ADMIN' || t.assigneeId === me.id ||
      ((me.role === 'TEAM_LEAD' || me.role === 'COORDINATOR') && !!me.teamId && t.teamId === me.teamId);
    const requesterClosing = t.requesterId === me.id && dto.status !== undefined && ['RESOLVED', 'CLOSED'].includes(dto.status) && Object.keys(dto).length === 1;
    if (!isStaff && !requesterClosing) throw new ForbiddenException('Only the assignee, team lead or admin can update this ticket');

    if (dto.assigneeId) {
      if (!isStaff) throw new ForbiddenException('Only the assignee, team lead or admin can reassign');
      const u = await this.prisma.user.findFirst({ where: { id: dto.assigneeId, isActive: true }, select: { id: true, teamId: true } });
      if (!u) throw new BadRequestException('Invalid assignee');
      if (me.role !== 'ADMIN' && t.teamId && u.teamId !== t.teamId) throw new BadRequestException('The assignee is not in this team');
    }

    const closing = dto.status === 'RESOLVED' || dto.status === 'CLOSED';
    const reopening = dto.status === 'OPEN' || dto.status === 'IN_PROGRESS';
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        ...(dto.status !== undefined ? { status: dto.status as any } : {}),
        ...(dto.resolution !== undefined ? { resolution: dto.resolution } : {}),
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
        ...(closing ? { resolvedById: me.id, resolvedAt: new Date() } : {}),
        ...(reopening ? { resolvedById: null, resolvedAt: null } : {}),
      },
      include: TICKET_INCLUDE,
    });
    await this.audit.log({ actorId: me.id, action: 'TICKET_UPDATE', entity: 'ticket', entityId: id, metadata: dto as any, ip });
    if (dto.status && dto.status !== t.status) {
      const audience = [t.requesterId, t.assigneeId, dto.assigneeId].filter((x): x is string => !!x && x !== me.id);
      await this.notifications.notify(audience, {
        type: 'TICKET',
        title: `Ticket ${updated.status.toLowerCase().replace('_', ' ')}: ${updated.subject}`,
        body: dto.resolution ? dto.resolution.slice(0, 300) : `Updated by ${me.displayName}`,
        link: `/tickets/${id}`,
      });
    }
    return updated;
  }

  async addMessage(me: RequestUser, id: string, dto: AddTicketMessageDto) {
    const t = await this.mustSee(me, id);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Write a message');
    const m = await this.prisma.ticketMessage.create({
      data: { ticketId: id, authorId: me.id, body },
      include: { author: { select: { id: true, displayName: true, role: true } } },
    });
    const audience = [t.requesterId, t.assigneeId].filter((x): x is string => !!x && x !== me.id);
    await this.notifications.notify(audience, {
      type: 'TICKET', title: `New reply on: ${t.subject}`, body: `${me.displayName}: ${body.slice(0, 200)}`, link: `/tickets/${id}`,
    });
    return m;
  }
}
