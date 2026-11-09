import {
  BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException,
  PayloadTooLargeException, ServiceUnavailableException,
} from '@nestjs/common';
import { FileContext } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import { join, resolve, sep } from 'path';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import type { Request, Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { UserCacheService } from '../../common/user-cache.service';
import { canSeeChannel, canSeeTask } from '../../common/access';
import { FILE_SELECT } from '../../common/file-links.service';
import { AuditService } from '../audit/audit.service';
import { RealtimeGateway } from '../comms/realtime.gateway';
import { NotificationsService } from '../comms/notifications.service';
import { contentDisposition, cleanFileName, decideMime, INLINE_OK } from './file-types';

export const UPLOAD_ROOT = resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'));
const MAX_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_MB ?? 100)) * 1024 * 1024;
const AVATAR_MAX = 1.5 * 1024 * 1024;
const MIN_FREE_BYTES = 300 * 1024 * 1024;
const ACCEL = process.env.ACCEL_REDIRECT === 'true';
const DAY = 86_400_000;

const CONTEXTS: FileContext[] = ['TASK', 'COMMENT', 'CHANNEL', 'REPORT', 'ANNOUNCEMENT'];

@Injectable()
export class FilesService {
  private log = new Logger('Files');
  private avatarCache: { exp: number; map: Record<string, string> } | null = null;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private cache: UserCacheService,
    private gateway: RealtimeGateway,
    private notifications: NotificationsService,
  ) {
    void fs.mkdir(join(UPLOAD_ROOT, 'tmp'), { recursive: true }).catch((e) => this.log.error(`cannot create ${UPLOAD_ROOT}: ${e.message}`));
  }

  // ---------- upload ----------
  /** Streams the request body to disk (never held in memory), hashing and size-limiting as it goes. */
  private async receive(req: Request, maxBytes: number) {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBytes) throw new PayloadTooLargeException(`File is too large (max ${Math.round(maxBytes / 1048576)} MB)`);
    try {
      const st = await fs.statfs(UPLOAD_ROOT);
      if (st.bavail * st.bsize < MIN_FREE_BYTES) throw new ServiceUnavailableException('Server storage is almost full. Please tell your admin.');
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
    }
    await fs.mkdir(join(UPLOAD_ROOT, 'tmp'), { recursive: true });
    const tmp = join(UPLOAD_ROOT, 'tmp', randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    let head = Buffer.alloc(0);
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) return cb(new PayloadTooLargeException(`File is too large (max ${Math.round(maxBytes / 1048576)} MB)`));
        if (head.length < 64) head = Buffer.concat([head, chunk.slice(0, 64 - head.length)]);
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(req, meter, createWriteStream(tmp, { flags: 'wx', mode: 0o640 }));
    } catch (e) {
      await fs.unlink(tmp).catch(() => {});
      if (e instanceof PayloadTooLargeException) throw e;
      throw new BadRequestException('Upload was interrupted. Please try again.');
    }
    if (size === 0) {
      await fs.unlink(tmp).catch(() => {});
      throw new BadRequestException('The file is empty');
    }
    return { tmp, size, head, sha256: hash.digest('hex') };
  }

  private async commit(tmp: string): Promise<string> {
    const now = new Date();
    const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}`;
    const dest = join(UPLOAD_ROOT, key);
    await fs.mkdir(join(UPLOAD_ROOT, key, '..'), { recursive: true });
    await fs.rename(tmp, dest);
    return key;
  }

  async upload(
    me: RequestUser,
    req: Request,
    q: { context?: string; scopeId?: string; name?: string; w?: string; h?: string },
  ) {
    const context = String(q.context ?? '') as FileContext;
    if (!CONTEXTS.includes(context)) throw new BadRequestException('Unknown upload context');
    const scopeId = q.scopeId ? String(q.scopeId) : null;
    await this.assertCanUploadTo(me, context, scopeId);

    const name = cleanFileName(q.name);
    const got = await this.receive(req, MAX_BYTES);
    const mime = decideMime(got.head, name);
    const dim = (v?: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 20000 ? n : null; };
    const isImg = mime.startsWith('image/');
    const key = await this.commit(got.tmp);
    const row = await this.prisma.fileAsset.create({
      data: {
        uploaderId: me.id, context, scopeId, name, mime, size: got.size, sha256: got.sha256, storageKey: key,
        width: isImg ? dim(q.w) : null, height: isImg ? dim(q.h) : null,
        // Task-level attachments belong to the task immediately; everything else is claimed when the message/comment/report is saved.
        ...(context === 'TASK' && scopeId ? { taskId: scopeId } : {}),
      },
      select: FILE_SELECT,
    });
    if (context === 'TASK' && scopeId) {
      await this.audit.log({ actorId: me.id, action: 'FILE_ATTACH', entity: 'task', entityId: scopeId, metadata: { file: name, size: got.size }, ip: req.ip });
    }
    return row;
  }

  private async assertCanUploadTo(me: RequestUser, context: FileContext, scopeId: string | null) {
    if (context === 'TASK' || context === 'COMMENT') {
      if (!scopeId) throw new BadRequestException('scopeId (task id) is required');
      const t = await this.prisma.task.findUnique({ where: { id: scopeId }, include: { collaborators: { select: { userId: true } } } });
      if (!t) throw new NotFoundException('Task not found');
      if (!canSeeTask(me, t)) throw new ForbiddenException('Forbidden');
    } else if (context === 'CHANNEL') {
      if (!scopeId) throw new BadRequestException('scopeId (channel id) is required');
      const ch = await this.prisma.channel.findUnique({
        where: { id: scopeId },
        select: {
          type: true, teamId: true, batchId: true, createdById: true,
          members: { select: { userId: true } },
          batch: { select: { leadId: true, coordinatorId: true } },
        },
      });
      if (!ch) throw new NotFoundException('Channel not found');
      if (!canSeeChannel(me, {
        type: ch.type, teamId: ch.teamId, batchId: ch.batchId, createdById: ch.createdById,
        memberIds: ch.members.map((m) => m.userId),
        batchLeadId: ch.batch?.leadId ?? null, batchCoordinatorId: ch.batch?.coordinatorId ?? null,
      })) throw new ForbiddenException('Forbidden');
    } else if (context === 'ANNOUNCEMENT') {
      if (me.role !== 'ADMIN' && me.role !== 'TEAM_LEAD') throw new ForbiddenException('Forbidden');
    }
  }

  // ---------- avatars ----------
  async setAvatar(me: RequestUser, req: Request) {
    const got = await this.receive(req, AVATAR_MAX);
    const mime = decideMime(got.head, 'avatar.jpg');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) {
      await fs.unlink(got.tmp).catch(() => {});
      throw new BadRequestException('Profile photo must be a JPEG, PNG or WebP image');
    }
    const key = await this.commit(got.tmp);
    const asset = await this.prisma.fileAsset.create({
      data: { uploaderId: me.id, context: 'AVATAR', name: 'avatar', mime, size: got.size, sha256: got.sha256, storageKey: key, width: 384, height: 384 },
      select: FILE_SELECT,
    });
    const prev = await this.prisma.user.findUnique({ where: { id: me.id }, select: { avatarFileId: true } });
    await this.prisma.user.update({ where: { id: me.id }, data: { avatarFileId: asset.id } });
    if (prev?.avatarFileId) await this.prisma.fileAsset.updateMany({ where: { id: prev.avatarFileId }, data: { deletedAt: new Date() } });
    this.afterAvatarChange(me.id);
    await this.audit.log({ actorId: me.id, action: 'AVATAR_SET', entity: 'user', entityId: me.id, ip: req.ip });
    return { avatarFileId: asset.id };
  }

  async removeAvatar(actor: RequestUser, userId: string, ip?: string) {
    const target = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, teamId: true, avatarFileId: true, role: true } });
    if (!target) throw new NotFoundException('User not found');
    const allowed = actor.id === userId || actor.role === 'ADMIN' || (actor.role === 'TEAM_LEAD' && !!actor.teamId && actor.teamId === target.teamId);
    if (!allowed) throw new ForbiddenException('Forbidden');
    if (target.avatarFileId) await this.prisma.fileAsset.updateMany({ where: { id: target.avatarFileId }, data: { deletedAt: new Date() } });
    await this.prisma.user.update({ where: { id: userId }, data: { avatarFileId: null } });
    this.afterAvatarChange(userId);
    if (actor.id !== userId) {
      await this.notifications.notify([userId], { type: 'SYSTEM', title: 'Please upload a new profile photo', body: `${actor.displayName} removed your photo. Choose a clear photo of your face.`, link: '/profile' });
    }
    await this.audit.log({ actorId: actor.id, action: 'AVATAR_REMOVE', entity: 'user', entityId: userId, ip });
    return { ok: true };
  }

  private afterAvatarChange(userId: string) {
    this.avatarCache = null;
    this.cache.invalidate(userId);
    this.gateway.server?.emit('avatar:changed', { userId });
  }

  /** {userId: avatarFileId} for everyone with a photo: one small request lets the whole UI show faces. */
  async avatarMap() {
    if (this.avatarCache && this.avatarCache.exp > Date.now()) return this.avatarCache.map;
    const rows = await this.prisma.user.findMany({ where: { avatarFileId: { not: null } }, select: { id: true, avatarFileId: true } });
    const map: Record<string, string> = {};
    for (const r of rows) map[r.id] = r.avatarFileId!;
    this.avatarCache = { exp: Date.now() + 30_000, map };
    return map;
  }

  async serveAvatar(userId: string, v: string | undefined, res: Response) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarFileId: true } });
    if (!u?.avatarFileId) throw new NotFoundException('No photo');
    const f = await this.prisma.fileAsset.findFirst({ where: { id: u.avatarFileId, deletedAt: null } });
    if (!f) throw new NotFoundException('No photo');
    const immutable = v === f.id; // the URL carries the file id, so a changed photo = a new URL
    this.send(res, f, false, immutable ? 'private, max-age=31536000, immutable' : 'private, max-age=300');
  }

  // ---------- download ----------
  private async canAccess(me: RequestUser, f: any): Promise<boolean> {
    if (f.context === 'AVATAR') return true;
    if (f.uploaderId === me.id) return true;
    // Admins moderate everything except private chat files: group/DM attachments stay members-only.
    if (me.role === 'ADMIN' && !(f.context === 'CHANNEL' && f.messageId)) return true;
    if (f.taskId || f.commentId) {
      const taskId = f.taskId ?? (await this.prisma.taskComment.findUnique({ where: { id: f.commentId }, select: { taskId: true } }))?.taskId;
      if (!taskId) return false;
      const t = await this.prisma.task.findUnique({ where: { id: taskId }, include: { collaborators: { select: { userId: true } } } });
      return !!t && canSeeTask(me, t);
    }
    if (f.messageId) {
      const m = await this.prisma.channelMessage.findUnique({
        where: { id: f.messageId },
        select: {
          channel: {
            select: {
              type: true, teamId: true, batchId: true, createdById: true,
              members: { select: { userId: true } },
              batch: { select: { leadId: true, coordinatorId: true } },
            },
          },
        },
      });
      if (!m) return false;
      const ch = m.channel;
      return canSeeChannel(me, {
        type: ch.type, teamId: ch.teamId, batchId: ch.batchId, createdById: ch.createdById,
        memberIds: ch.members.map((x) => x.userId),
        batchLeadId: ch.batch?.leadId ?? null, batchCoordinatorId: ch.batch?.coordinatorId ?? null,
      });
    }
    if (f.reportId) {
      const r = await this.prisma.dailyReport.findUnique({ where: { id: f.reportId }, select: { userId: true, teamId: true } });
      if (!r) return false;
      return r.userId === me.id || me.role === 'TEAM_LEAD' || (me.role === 'COORDINATOR' && !!me.teamId && me.teamId === r.teamId);
    }
    if (f.announcementId) {
      const a = await this.prisma.announcement.findUnique({ where: { id: f.announcementId }, select: { scope: true, teamId: true, batchId: true } });
      if (!a) return false;
      if (a.scope === 'COMPANY') return true;
      if (me.role === 'TEAM_LEAD') return true;
      const u = await this.cache.get(me.id);
      return a.scope === 'TEAM' ? u?.teamId === a.teamId : u?.batchId === a.batchId;
    }
    return false; // pending upload that is not yours
  }

  async serve(me: RequestUser, id: string, inline: boolean, res: Response) {
    const f = await this.prisma.fileAsset.findUnique({ where: { id } });
    if (!f || f.deletedAt) throw new NotFoundException('File not found');
    if (!(await this.canAccess(me, f))) throw new ForbiddenException('Forbidden');
    this.send(res, f, inline, 'private, max-age=3600');
  }

  private send(res: Response, f: { mime: string; name: string; size: number; storageKey: string; id: string }, wantInline: boolean, cache: string) {
    const inline = wantInline && INLINE_OK.has(f.mime);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', f.name));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Even if something odd slips through, the browser may not run scripts from a user file.
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'");
    res.setHeader('Cache-Control', cache);
    res.setHeader('ETag', `"${f.id}"`);
    if (ACCEL) {
      // Nginx streams the bytes (ranges, sendfile) so Node stays free for chat and API traffic.
      res.setHeader('X-Accel-Redirect', `/_protected/${f.storageKey}`);
      return res.end();
    }
    const abs = resolve(UPLOAD_ROOT, f.storageKey);
    if (!abs.startsWith(UPLOAD_ROOT + sep)) throw new ForbiddenException('Forbidden');
    res.sendFile(abs, { dotfiles: 'deny', acceptRanges: true, cacheControl: false, lastModified: false, etag: false }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ statusCode: 404, message: 'File missing on server' });
    });
  }

  // ---------- delete ----------
  async remove(me: RequestUser, id: string, ip?: string) {
    const f = await this.prisma.fileAsset.findUnique({ where: { id } });
    if (!f || f.deletedAt) throw new NotFoundException('File not found');
    let allowed = f.uploaderId === me.id || me.role === 'ADMIN';
    if (!allowed && me.role === 'TEAM_LEAD' && me.teamId) {
      const taskId = f.taskId ?? (f.commentId ? (await this.prisma.taskComment.findUnique({ where: { id: f.commentId }, select: { taskId: true } }))?.taskId : null);
      if (taskId) allowed = (await this.prisma.task.findUnique({ where: { id: taskId }, select: { teamId: true } }))?.teamId === me.teamId;
    }
    if (!allowed) throw new ForbiddenException('Only the uploader or an admin can delete this file');
    await this.prisma.fileAsset.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ actorId: me.id, action: 'FILE_DELETE', entity: 'file', entityId: id, metadata: { name: f.name }, ip });
    return { ok: true };
  }

  // ---------- housekeeping (called by the daily job) ----------
  async sweep() {
    const now = Date.now();
    // 1. uploads that were never attached to anything (abandoned drafts) after 24 h
    const abandoned = await this.prisma.fileAsset.updateMany({
      where: {
        deletedAt: null, context: { not: 'AVATAR' }, createdAt: { lt: new Date(now - DAY) },
        taskId: null, commentId: null, messageId: null, reportId: null, announcementId: null,
      },
      data: { deletedAt: new Date() },
    });
    // 2. physically remove files deleted more than 7 days ago
    const old = await this.prisma.fileAsset.findMany({ where: { deletedAt: { lt: new Date(now - 7 * DAY) } }, select: { id: true, storageKey: true }, take: 500 });
    for (const f of old) await fs.unlink(resolve(UPLOAD_ROOT, f.storageKey)).catch(() => {});
    if (old.length) await this.prisma.fileAsset.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    // 3. stale temp files from interrupted uploads
    let tmpRemoved = 0;
    try {
      for (const n of await fs.readdir(join(UPLOAD_ROOT, 'tmp'))) {
        const p = join(UPLOAD_ROOT, 'tmp', n);
        const st = await fs.stat(p);
        if (now - st.mtimeMs > 6 * 3600_000) { await fs.unlink(p).catch(() => {}); tmpRemoved++; }
      }
    } catch { /* tmp dir missing */ }
    return { abandoned: abandoned.count, purged: old.length, tmpRemoved };
  }

  async stats() {
    const agg = await this.prisma.fileAsset.aggregate({ where: { deletedAt: null }, _count: true, _sum: { size: true } });
    let freeMb: number | null = null;
    try { const st = await fs.statfs(UPLOAD_ROOT); freeMb = Math.round((st.bavail * st.bsize) / 1048576); } catch { /* ignore */ }
    return { files: agg._count, usedMb: Math.round((agg._sum.size ?? 0) / 1048576), diskFreeMb: freeMb };
  }
}
