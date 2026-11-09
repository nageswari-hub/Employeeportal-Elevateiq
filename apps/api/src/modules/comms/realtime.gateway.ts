import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { UserCacheService } from '../../common/user-cache.service';
import { canSeeChannel, canSeeTask } from '../../common/access';

function parseAccessCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'access') return rest.join('=');
  }
  return undefined;
}

/**
 * Rooms:  user:{id} private · team:{id} team + its leads + admins · admins · task:{id} / channel:{id} joined on demand after a permission check.
 * Big payloads (messages, comments) go only to the room of people who may read them; wide rooms get tiny "something changed" pings.
 */
@WebSocketGateway({
  cors: { origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true },
  pingInterval: 20_000,
  pingTimeout: 25_000,
  maxHttpBufferSize: 64 * 1024, // sockets carry text only; files go over HTTP
  perMessageDeflate: false, // CPU > bandwidth for short messages on one small server
  transports: ['websocket', 'polling'],
})
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private online = new Map<string, number>(); // userId -> open sockets
  private offlineTimers = new Map<string, NodeJS.Timeout>();
  private teamIdsCache: { exp: number; ids: string[] } | null = null;

  constructor(private prisma: PrismaService, private jwt: JwtService, private users: UserCacheService) {}

  private async allTeamIds(): Promise<string[]> {
    if (this.teamIdsCache && this.teamIdsCache.exp > Date.now()) return this.teamIdsCache.ids;
    const ids = (await this.prisma.team.findMany({ select: { id: true } })).map((t) => t.id);
    this.teamIdsCache = { exp: Date.now() + 60_000, ids };
    return ids;
  }

  async handleConnection(client: Socket) {
    try {
      const token = parseAccessCookie(client.handshake.headers.cookie) ?? (client.handshake.auth?.token as string | undefined);
      if (!token) return client.disconnect();
      const payload = (await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET })) as any;
      const user = await this.users.get(payload.sub);
      if (!user || !user.isActive) return client.disconnect();
      client.data.user = { id: user.id, role: user.role, teamId: user.teamId };
      client.join(`user:${user.id}`);
      if (user.teamId) client.join(`team:${user.teamId}`);
      if (user.role === 'ADMIN') client.join('admins');
      if (user.role === 'ADMIN' || user.role === 'TEAM_LEAD') for (const id of await this.allTeamIds()) client.join(`team:${id}`);
      if (user.batchId) client.join(`batch:${user.batchId}`);
      const ledBatches = await this.prisma.batch.findMany({
        where: { OR: [{ leadId: user.id }, { coordinatorId: user.id }] }, select: { id: true },
      });
      for (const b of ledBatches) client.join(`batch:${b.id}`);

      const n = (this.online.get(user.id) ?? 0) + 1;
      this.online.set(user.id, n);
      const t = this.offlineTimers.get(user.id);
      if (t) { clearTimeout(t); this.offlineTimers.delete(user.id); }
      if (n === 1) this.server.emit('presence', { userId: user.id, online: true });
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const id = client.data?.user?.id as string | undefined;
    if (!id) return;
    const n = (this.online.get(id) ?? 1) - 1;
    if (n > 0) return void this.online.set(id, n);
    this.online.delete(id);
    // 8 s grace so a page refresh or Wi-Fi blip does not flash "offline" to everyone
    this.offlineTimers.set(id, setTimeout(() => {
      this.offlineTimers.delete(id);
      if (!this.online.has(id)) this.server.emit('presence', { userId: id, online: false });
    }, 8_000));
  }

  onlineIds(): string[] {
    return [...this.online.keys()];
  }

  onlineCount(): number {
    return this.online.size;
  }

  // ----- joins (permission-checked) -----
  @SubscribeMessage('joinTask')
  async joinTask(@ConnectedSocket() client: Socket, @MessageBody() body: { taskId?: string }) {
    const me = client.data.user as { id: string; role: string; teamId: string | null } | undefined;
    if (!me || !body?.taskId) return { ok: false };
    const t = await this.prisma.task.findUnique({ where: { id: body.taskId }, include: { collaborators: { select: { userId: true } } } });
    if (!t || !canSeeTask(me as any, t)) return { ok: false };
    client.join(`task:${t.id}`);
    return { ok: true };
  }

  @SubscribeMessage('joinChannel')
  async joinChannel(@ConnectedSocket() client: Socket, @MessageBody() body: { channelId?: string }) {
    const me = client.data.user as { id: string; role: string; teamId: string | null } | undefined;
    if (!me || !body?.channelId) return { ok: false };
    const ch = await this.prisma.channel.findUnique({
      where: { id: body.channelId },
      select: {
        id: true, type: true, teamId: true, batchId: true, createdById: true,
        members: { select: { userId: true } },
        batch: { select: { leadId: true, coordinatorId: true } },
      },
    });
    const allowed = ch && canSeeChannel(me as any, {
      type: ch.type, teamId: ch.teamId, batchId: ch.batchId, createdById: ch.createdById,
      memberIds: ch.members.map((m) => m.userId),
      batchLeadId: ch.batch?.leadId ?? null, batchCoordinatorId: ch.batch?.coordinatorId ?? null,
    });
    if (!ch || !allowed) return { ok: false };
    // one open channel per socket keeps rooms (and fan-out) small
    for (const r of client.rooms) if (r.startsWith('channel:') && r !== `channel:${ch.id}`) client.leave(r);
    client.join(`channel:${ch.id}`);
    return { ok: true };
  }

  @SubscribeMessage('leaveChannel')
  leaveChannel(@ConnectedSocket() client: Socket, @MessageBody() body: { channelId?: string }) {
    if (body?.channelId) client.leave(`channel:${body.channelId}`);
    return { ok: true };
  }

  /** Typing indicator: relayed live, never stored. Only people already inside the channel room can send/receive it. */
  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { channelId?: string; name?: string }) {
    const me = client.data.user as { id: string } | undefined;
    if (!me || !body?.channelId || !client.rooms.has(`channel:${body.channelId}`)) return;
    client.to(`channel:${body.channelId}`).emit('typing', { channelId: body.channelId, userId: me.id });
  }

  // ----- emitters -----
  emitTask(taskId: string, teamId: string | null, event: string, payload: unknown) {
    this.server.to(`task:${taskId}`).emit(event, payload);
    if (teamId) this.server.to(`team:${teamId}`).emit('task:changed', { taskId, event });
  }

  disconnectUser(userId: string) {
    this.server?.in(`user:${userId}`).disconnectSockets(true);
  }

  /**
   * Full message to people reading the channel right now; a tiny ping to everyone else who can see it
   * (for unread badges). Private groups/DMs ping only their members; batch pings go to the batch room.
   */
  emitChannelMessage(
    ch: { id: string; type?: string; teamId: string | null; batchId?: string | null; memberIds?: string[] },
    message: unknown,
    authorId: string,
  ) {
    this.server.to(`channel:${ch.id}`).emit('channel:message', message);
    const ping = { channelId: ch.id, authorId, at: Date.now() };
    if (ch.type === 'GROUP' || ch.type === 'DM') this.emitToUsers(ch.memberIds ?? [], ping);
    else if (ch.type === 'BATCH' && ch.batchId) {
      this.server.to(`batch:${ch.batchId}`).emit('channel:activity', ping);
      this.server.to('admins').emit('channel:activity', ping);
    } else if (ch.type === 'TEAM' && ch.teamId) this.server.to(`team:${ch.teamId}`).emit('channel:activity', ping);
    else this.server.emit('channel:activity', ping);
  }

  emitChannelDeleted(channelId: string, messageId: string) {
    this.server.to(`channel:${channelId}`).emit('channel:deleted', { channelId, messageId });
  }

  /** Attendance changed: ids only, staff screens refetch (debounced). */
  emitAttendance(teamId: string | null, userId: string) {
    const payload = { userId, teamId, at: Date.now() };
    this.server.to('admins').emit('attendance:changed', payload);
    if (teamId) this.server.to(`team:${teamId}`).emit('attendance:changed', payload);
  }

  emitToUsers(userIds: string[], payload: unknown) {
    for (const id of new Set(userIds)) this.server.to(`user:${id}`).emit('notify', payload);
  }
}
