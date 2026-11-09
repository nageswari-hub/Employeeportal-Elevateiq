import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { canSeeChannel, ChannelAccessInfo } from '../../common/access';
import { FileLinkService, LIVE_FILES } from '../../common/file-links.service';
import { CreateChannelDto, PostMessageDto } from './dto/comms.dto';
import { RealtimeGateway } from './realtime.gateway';

const MSG_INCLUDE = {
  author: { select: { id: true, displayName: true } },
  files: LIVE_FILES,
} as const;

const ACCESS_INCLUDE = {
  members: { select: { userId: true, user: { select: { id: true, displayName: true } } } },
  batch: { select: { leadId: true, coordinatorId: true } },
} as const;

const CHANNEL_TYPES = ['COMPANY', 'TEAM', 'BATCH', 'GROUP', 'DM'] as const;
type ChannelType = (typeof CHANNEL_TYPES)[number];

function toWire(m: any) {
  return {
    id: m.id, channelId: m.channelId, clientId: m.clientId ?? null, createdAt: m.createdAt, author: m.author,
    body: m.deletedAt ? '' : m.body, deleted: Boolean(m.deletedAt), files: m.deletedAt ? [] : m.files ?? [],
  };
}

@Injectable()
export class ChannelsService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway, private links: FileLinkService) {}

  private accessOf(ch: any): ChannelAccessInfo {
    return {
      type: ch.type,
      teamId: ch.teamId,
      batchId: ch.batchId,
      createdById: ch.createdById,
      memberIds: (ch.members ?? []).map((m: any) => m.userId),
      batchLeadId: ch.batch?.leadId ?? null,
      batchCoordinatorId: ch.batch?.coordinatorId ?? null,
    };
  }

  /**
   * Makes sure every batch the user can see has its own channel. Runs on chat load and is
   * idempotent, so existing batches get channels without a manual migration or admin action.
   */
  private async ensureBatchChannels(me: RequestUser) {
    const where: Prisma.BatchWhereInput = me.role === 'ADMIN'
      ? { isActive: true }
      : { OR: [{ id: me.batchId ?? '__none__' }, { leadId: me.id }, { coordinatorId: me.id }] };
    const batches = await this.prisma.batch.findMany({ where, select: { id: true, name: true }, take: 500 });
    if (!batches.length) return;
    const existing = await this.prisma.channel.findMany({
      where: { batchId: { in: batches.map((b) => b.id) } }, select: { batchId: true },
    });
    const have = new Set(existing.map((c) => c.batchId));
    const missing = batches.filter((b) => !have.has(b.id));
    if (!missing.length) return;
    for (const b of missing) {
      await this.prisma.channel.create({
        data: { type: 'BATCH', batchId: b.id, name: b.name.slice(0, 80), createdById: me.id },
      }).catch(() => { /* another request created it first */ });
    }
  }

  /** Filter used by GET /channels; `teamId=company` keeps the old company-only behaviour. */
  private async visibleWhere(me: RequestUser, filter?: string): Promise<Prisma.ChannelWhereInput> {
    if (filter === 'company') return { type: 'COMPANY' };
    if (filter) {
      if (!canSeeChannel(me, { type: 'TEAM', teamId: filter })) throw new ForbiddenException('Forbidden');
      return { type: 'TEAM', teamId: filter };
    }
    // Admins see every public channel, but private groups/DMs only when they are members.
    if (me.role === 'ADMIN') return { OR: [{ type: { notIn: ['GROUP', 'DM'] } }, { members: { some: { userId: me.id } } }] };
    const ledBatches = await this.prisma.batch.findMany({
      where: { OR: [{ leadId: me.id }, { coordinatorId: me.id }] }, select: { id: true },
    });
    const or: Prisma.ChannelWhereInput[] = [
      { type: 'COMPANY' },
      { members: { some: { userId: me.id } } },
    ];
    if (me.teamId) or.push({ type: 'TEAM', teamId: me.teamId });
    if (me.role === 'TEAM_LEAD') or.push({ type: 'TEAM' });
    if (me.batchId) or.push({ type: 'BATCH', batchId: me.batchId });
    if (ledBatches.length) or.push({ type: 'BATCH', batchId: { in: ledBatches.map((b) => b.id) } });
    return { OR: or };
  }

  /** Channel list with unread counts and last activity, in two queries total (not one per channel). */
  async list(me: RequestUser, filter?: string) {
    await this.ensureBatchChannels(me);
    const channels = await this.prisma.channel.findMany({
      where: await this.visibleWhere(me, filter), orderBy: [{ type: 'asc' }, { createdAt: 'asc' }], take: 300,
      include: {
        team: { select: { name: true } },
        batch: { select: { id: true, name: true } },
        members: { select: { userId: true, user: { select: { id: true, displayName: true } } } },
      },
    });
    if (!channels.length) return [];
    const since = (await this.prisma.user.findUnique({ where: { id: me.id }, select: { createdAt: true } }))?.createdAt ?? new Date(0);
    const ids = channels.map((c) => c.id);
    const rows = await this.prisma.$queryRaw<Array<{ channelId: string; unread: number; last: Date }>>(Prisma.sql`
      SELECT m."channelId" AS "channelId",
             count(*) FILTER (WHERE m."authorId" <> ${me.id} AND m."createdAt" > COALESCE(r."lastReadAt", ${since}))::int AS unread,
             max(m."createdAt") AS last
      FROM channel_messages m
      LEFT JOIN channel_reads r ON r."channelId" = m."channelId" AND r."userId" = ${me.id}
      WHERE m."channelId" IN (${Prisma.join(ids)}) AND m."deletedAt" IS NULL
      GROUP BY m."channelId"`);
    const by = new Map(rows.map((r) => [r.channelId, r]));
    return channels.map((c) => {
      const peer = c.type === 'DM' ? c.members.find((m) => m.userId !== me.id)?.user ?? null : null;
      return {
        id: c.id, type: c.type, name: peer?.displayName ?? c.name, description: c.description,
        teamId: c.teamId, batchId: c.batchId, team: c.team, batch: c.batch, createdAt: c.createdAt,
        peer, memberIds: (c.members ?? []).map((m) => m.userId),
        memberCount: c.members.length,
        unread: by.get(c.id)?.unread ?? 0, lastMessageAt: by.get(c.id)?.last ?? null,
      };
    });
  }

  async totalUnread(me: RequestUser) {
    const list = await this.list(me);
    return { unread: list.reduce((s, c) => s + c.unread, 0) };
  }

  /** Active people for the "new group" / "new message" pickers. */
  async contacts(me: RequestUser) {
    const users = await this.prisma.user.findMany({
      where: { isActive: true, id: { not: me.id } }, take: 500,
      select: { id: true, displayName: true, role: true, team: { select: { name: true } }, batch: { select: { name: true } } },
      orderBy: { displayName: 'asc' },
    });
    return users;
  }

  async create(me: RequestUser, dto: CreateChannelDto) {
    const type = (dto.type ?? (dto.batchId ? 'BATCH' : dto.teamId ? 'TEAM' : 'COMPANY')) as ChannelType;
    if (!CHANNEL_TYPES.includes(type)) throw new BadRequestException('Invalid channel type');
    const name = dto.name?.trim();

    if (type === 'COMPANY') {
      if (me.role !== 'ADMIN') throw new ForbiddenException('Company channels are admin-only');
      if (!name) throw new BadRequestException('Channel name is required');
      await this.assertNameFree(null, name);
      return this.prisma.channel.create({ data: { type, teamId: null, name, description: dto.description ?? null, createdById: me.id } });
    }

    if (type === 'TEAM') {
      const teamId = dto.teamId ?? me.teamId;
      if (!teamId) throw new BadRequestException('teamId required');
      const can = me.role === 'ADMIN' || ((me.role === 'TEAM_LEAD' || me.role === 'COORDINATOR') && me.teamId === teamId);
      if (!can) throw new ForbiddenException('Only the team lead, coordinator or admin creates team channels');
      if (!name) throw new BadRequestException('Channel name is required');
      const t = await this.prisma.team.findUnique({ where: { id: teamId } });
      if (!t) throw new BadRequestException('Invalid teamId');
      await this.assertNameFree(teamId, name);
      return this.prisma.channel.create({ data: { type, teamId, name, description: dto.description ?? null, createdById: me.id } });
    }

    if (type === 'BATCH') {
      if (!dto.batchId) throw new BadRequestException('batchId required');
      const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
      if (!batch) throw new BadRequestException('Invalid batchId');
      const can = me.role === 'ADMIN' || batch.leadId === me.id || batch.coordinatorId === me.id;
      if (!can) throw new ForbiddenException('Only the batch lead, coordinator or admin creates its channel');
      const existing = await this.prisma.channel.findFirst({ where: { batchId: batch.id } });
      if (existing) return existing;
      return this.prisma.channel.create({
        data: {
          type, batchId: batch.id, name: (name || batch.name).slice(0, 80),
          description: dto.description ?? null, createdById: me.id,
        },
      });
    }

    if (type === 'GROUP') {
      if (!name) throw new BadRequestException('Group name is required');
      const ids = await this.validMemberIds(me, dto.memberIds ?? [], true);
      return this.prisma.channel.create({
        data: {
          type, name, description: dto.description ?? null, createdById: me.id,
          members: { create: ids.map((userId) => ({ userId })) },
        },
        include: ACCESS_INCLUDE,
      });
    }

    // DM: exactly one other active person; reuse the existing conversation when there is one.
    const others = [...new Set((dto.memberIds ?? []).filter((id) => id !== me.id))];
    if (others.length !== 1) throw new BadRequestException('Pick exactly one person for a direct message');
    const other = await this.prisma.user.findFirst({ where: { id: others[0], isActive: true }, select: { id: true, displayName: true } });
    if (!other) throw new BadRequestException('Person not found');
    const existing = await this.prisma.channel.findFirst({
      where: {
        type: 'DM',
        AND: [{ members: { some: { userId: me.id } } }, { members: { some: { userId: other.id } } }],
        members: { every: { userId: { in: [me.id, other.id] } } },
      },
      include: ACCESS_INCLUDE,
    });
    if (existing) return existing;
    return this.prisma.channel.create({
      data: {
        type, name: `${me.displayName} & ${other.displayName}`.slice(0, 80), createdById: me.id,
        members: { create: [{ userId: me.id }, { userId: other.id }] },
      },
      include: ACCESS_INCLUDE,
    });
  }

  private async assertNameFree(teamId: string | null, name: string) {
    const dupe = await this.prisma.channel.findFirst({ where: { teamId, name: { equals: name, mode: 'insensitive' } } });
    if (dupe) throw new BadRequestException('Channel name already exists here');
  }

  private async validMemberIds(me: RequestUser, ids: string[], includeMe: boolean) {
    const wanted = [...new Set(ids.filter(Boolean))];
    if (includeMe && !wanted.includes(me.id)) wanted.push(me.id);
    if (wanted.length > 50) throw new BadRequestException('A group can have at most 50 people');
    const count = await this.prisma.user.count({ where: { id: { in: wanted }, isActive: true } });
    if (count !== wanted.length) throw new BadRequestException('One or more people are not active');
    return wanted;
  }

  async addMembers(me: RequestUser, channelId: string, userIds: string[]) {
    const ch = await this.mustSee(me, channelId);
    if (ch.type !== 'GROUP') throw new BadRequestException('Only group chats have members');
    if (me.role !== 'ADMIN' && ch.createdById !== me.id) throw new ForbiddenException('Only the group creator can add people');
    const ids = await this.validMemberIds(me, userIds, false);
    await this.prisma.channelMember.createMany({ data: ids.map((userId) => ({ channelId, userId })), skipDuplicates: true });
    return { ok: true };
  }

  async removeMember(me: RequestUser, channelId: string, userId: string) {
    const ch = await this.mustSee(me, channelId);
    if (ch.type !== 'GROUP') throw new ForbiddenException('You can only leave a group chat');
    const can = userId === me.id || me.role === 'ADMIN' || ch.createdById === me.id;
    if (!can) throw new ForbiddenException('Only the group creator can remove people');
    await this.prisma.channelMember.deleteMany({ where: { channelId, userId } });
    return { ok: true };
  }

  private async mustSee(me: RequestUser, channelId: string) {
    const ch = await this.prisma.channel.findUnique({ where: { id: channelId }, include: ACCESS_INCLUDE });
    if (!ch) throw new NotFoundException('Channel not found');
    if (!canSeeChannel(me, this.accessOf(ch))) throw new ForbiddenException('Forbidden');
    return ch;
  }

  /**
   * Cursor pagination: `before` loads older messages, `after` fills the gap after a reconnect.
   * Index-backed (channelId, createdAt) so it stays fast with hundreds of thousands of messages.
   */
  async messages(me: RequestUser, channelId: string, q: { limit?: number; before?: string; after?: string }) {
    await this.mustSee(me, channelId);
    const take = Math.min(100, Math.max(1, Number(q.limit) || 40));
    const dateOf = async (id?: string) => (id ? (await this.prisma.channelMessage.findFirst({ where: { id, channelId }, select: { createdAt: true } }))?.createdAt : undefined);
    const [beforeAt, afterAt] = await Promise.all([dateOf(q.before), dateOf(q.after)]);
    const rows = await this.prisma.channelMessage.findMany({
      where: { channelId, ...(beforeAt ? { createdAt: { lt: beforeAt } } : {}), ...(afterAt ? { createdAt: { gt: afterAt } } : {}) },
      orderBy: [{ createdAt: afterAt ? 'asc' : 'desc' }, { id: afterAt ? 'asc' : 'desc' }],
      take: take + 1,
      include: MSG_INCLUDE,
    });
    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    if (!afterAt) page.reverse();
    return { messages: page.map(toWire), hasMore };
  }

  async post(me: RequestUser, channelId: string, dto: PostMessageDto) {
    const ch = await this.mustSee(me, channelId);
    const body = (dto.body ?? '').trim();
    if (!body && !dto.fileIds?.length) throw new BadRequestException('Write a message or attach a file');

    // Idempotent retry: same clientId from the same person returns the original message instead of a duplicate.
    if (dto.clientId) {
      const existing = await this.prisma.channelMessage.findUnique({
        where: { authorId_clientId: { authorId: me.id, clientId: dto.clientId } }, include: MSG_INCLUDE,
      });
      if (existing) return toWire(existing);
    }
    let msg;
    try {
      msg = await this.prisma.$transaction(async (tx) => {
        const created = await tx.channelMessage.create({ data: { channelId, authorId: me.id, body, clientId: dto.clientId ?? null } });
        await this.links.claim(tx, me.id, dto.fileIds, { context: 'CHANNEL', scopeId: channelId }, { messageId: created.id });
        return tx.channelMessage.findUniqueOrThrow({ where: { id: created.id }, include: MSG_INCLUDE });
      });
    } catch (e: any) {
      if (e?.code === 'P2002' && dto.clientId) {
        const again = await this.prisma.channelMessage.findUnique({ where: { authorId_clientId: { authorId: me.id, clientId: dto.clientId } }, include: MSG_INCLUDE });
        if (again) return toWire(again);
      }
      throw e;
    }
    const wire = toWire(msg);
    this.realtime.emitChannelMessage({ id: channelId, ...this.accessOf(ch) }, wire, me.id);
    // my own sending counts as "read up to now"
    void this.markRead(me, channelId).catch(() => {});
    return wire;
  }

  async remove(me: RequestUser, channelId: string, messageId: string) {
    const ch = await this.mustSee(me, channelId);
    const m = await this.prisma.channelMessage.findFirst({ where: { id: messageId, channelId } });
    if (!m || m.deletedAt) throw new NotFoundException('Message not found');
    const access = this.accessOf(ch);
    const canModerate =
      me.role === 'ADMIN' ||
      (ch.type === 'TEAM' && me.role === 'TEAM_LEAD' && !!ch.teamId && me.teamId === ch.teamId) ||
      (ch.type === 'BATCH' && (access.batchLeadId === me.id || access.batchCoordinatorId === me.id)) ||
      (ch.type === 'GROUP' && ch.createdById === me.id);
    if (m.authorId !== me.id && !canModerate) throw new ForbiddenException('You can delete your own messages');
    await this.prisma.$transaction([
      this.prisma.channelMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: '' } }),
      this.prisma.fileAsset.updateMany({ where: { messageId }, data: { deletedAt: new Date() } }),
    ]);
    this.realtime.emitChannelDeleted(channelId, messageId);
    return { ok: true };
  }

  async markRead(me: RequestUser, channelId: string) {
    await this.mustSee(me, channelId);
    await this.prisma.channelRead.upsert({
      where: { userId_channelId: { userId: me.id, channelId } },
      update: { lastReadAt: new Date() },
      create: { userId: me.id, channelId },
    });
    return { ok: true };
  }
}
