import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { UserCacheService } from '../../common/user-cache.service';
import { RealtimeGateway } from '../comms/realtime.gateway';
import { BulkCreateUsersDto, CreateUserDto, UpdateUserDto } from './dto/users.dto';

function pageOf(page?: number, limit?: number) {
  const p = Math.max(1, Number(page) || 1);
  const l = Math.min(100, Math.max(1, Number(limit) || 20));
  return { p, l, skip: (p - 1) * l, take: l };
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
/** Readable one-time password (no look-alike characters) that always satisfies the letter+number policy. */
export function tempPassword(len = 10): string {
  for (;;) {
    let out = '';
    for (let i = 0; i < len; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (/[A-Za-z]/.test(out) && /\d/.test(out)) return out;
  }
}

const LEAD_MANAGED_ROLES = ['COORDINATOR', 'EMPLOYEE'];

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private cache: UserCacheService,
    private gateway: RealtimeGateway,
  ) {}

  // Scope: ADMIN all; LEAD reads all; COORDINATOR own team only (none if unassigned); EMPLOYEE self only
  async list(me: RequestUser, q: { page?: number; limit?: number; teamId?: string; batchId?: string; role?: string; search?: string; active?: string }) {
    const { p, l, skip, take } = pageOf(q.page, q.limit);
    if (me.role === 'EMPLOYEE') {
      const self = await this.prisma.user.findUnique({ where: { id: me.id } });
      return { data: [this.safe(self)], meta: { total: 1, page: 1, limit: l, totalPages: 1 } };
    }
    const where: any = {};
    if (q.teamId) where.teamId = q.teamId;
    if (q.batchId) where.batchId = q.batchId;
    if (q.role) where.role = q.role;
    if (q.active === 'true') where.isActive = true;
    if (q.active === 'false') where.isActive = false;
    if (q.search?.trim()) {
      const s = q.search.trim();
      where.OR = [{ displayName: { contains: s, mode: 'insensitive' } }, { email: { contains: s, mode: 'insensitive' } }];
    }
    if (me.role === 'COORDINATOR') where.teamId = me.teamId ?? '__none__'; // unassigned coordinator sees nobody
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where, skip, take, orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
        include: { team: { select: { id: true, name: true } }, batch: { select: { id: true, name: true } } },
      }),
    ]);
    return { data: rows.map((r) => this.safe(r)), meta: { total, page: p, limit: l, totalPages: Math.max(1, Math.ceil(total / l)) } };
  }

  async get(me: RequestUser, id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (me.role === 'EMPLOYEE' && me.id !== id) throw new ForbiddenException('Forbidden');
    if (me.role === 'COORDINATOR' && user.id !== me.id && (!me.teamId || user.teamId !== me.teamId))
      throw new ForbiddenException('Forbidden');
    return this.safe(user);
  }

  /** Leads manage only coordinators/employees in their own team (or unassigned people they are claiming). */
  private assertCanManage(me: RequestUser, target: { id: string; role: string; teamId: string | null }) {
    if (me.role === 'ADMIN') return;
    if (me.role !== 'TEAM_LEAD') throw new ForbiddenException('Forbidden');
    if (!me.teamId) throw new ForbiddenException('You are not assigned to a team yet. Ask an admin.');
    if (!LEAD_MANAGED_ROLES.includes(target.role)) throw new ForbiddenException('Leads cannot manage admins or other leads');
    if (target.teamId && target.teamId !== me.teamId) throw new ForbiddenException('That person belongs to another team');
  }

  private async resolveRefs(teamId?: string | null, batchId?: string | null) {
    if (teamId) {
      const t = await this.prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
      if (!t) throw new BadRequestException('Invalid teamId');
    }
    if (batchId) {
      const b = await this.prisma.batch.findUnique({ where: { id: batchId }, select: { id: true } });
      if (!b) throw new BadRequestException('Invalid batchId');
    }
  }

  async create(me: RequestUser, dto: CreateUserDto, ip?: string) {
    if (me.role === 'TEAM_LEAD') {
      if (!me.teamId) throw new ForbiddenException('You are not assigned to a team yet. Ask an admin.');
      if (!LEAD_MANAGED_ROLES.includes(dto.role)) throw new ForbiddenException('Leads can create coordinators and employees only');
      if (dto.teamId && dto.teamId !== me.teamId) throw new ForbiddenException('Leads can add people to their own team only');
      dto.teamId = me.teamId;
    } else if (dto.role === 'ADMIN' && me.role !== 'ADMIN') {
      throw new ForbiddenException('Only admin can create admins');
    }
    await this.resolveRefs(dto.teamId, dto.batchId);
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email }, select: { id: true } });
    if (exists) throw new BadRequestException('Email already in use');

    const generated = !dto.password;
    const password = dto.password ?? tempPassword();
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await argon2.hash(password),
        displayName: dto.displayName,
        role: dto.role as any,
        teamId: dto.teamId ?? null,
        batchId: dto.batchId ?? null,
        mustChangePassword: true,
      },
    });
    await this.audit.log({ actorId: me.id, action: 'USER_CREATE', entity: 'user', entityId: user.id, metadata: { email: user.email, role: user.role }, ip });
    return { ...this.safe(user), ...(generated ? { tempPassword: password } : {}) };
  }

  async update(me: RequestUser, id: string, dto: UpdateUserDto, ip?: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    this.assertCanManage(me, target);
    if (dto.role === 'ADMIN' && me.role !== 'ADMIN') throw new ForbiddenException('Only admin can grant admin');
    if (me.role === 'TEAM_LEAD') {
      if (dto.role !== undefined && !LEAD_MANAGED_ROLES.includes(dto.role)) throw new ForbiddenException('Leads can assign coordinator or employee only');
      if (dto.teamId !== undefined && dto.teamId !== null && dto.teamId !== me.teamId) throw new ForbiddenException('Leads can only use their own team');
    }
    if (target.id === me.id && dto.role !== undefined && dto.role !== target.role) throw new BadRequestException('You cannot change your own role');
    await this.resolveRefs(dto.teamId ?? undefined, dto.batchId ?? undefined);

    const data: any = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.teamId !== undefined) data.teamId = dto.teamId;
    if (dto.batchId !== undefined) data.batchId = dto.batchId;
    if (dto.isActive !== undefined) {
      if (target.id === me.id && dto.isActive === false) throw new BadRequestException('Cannot deactivate yourself');
      data.isActive = dto.isActive;
      data.deactivatedAt = dto.isActive ? null : new Date(); // keeps leavers in historical attendance
    }
    if (dto.mustChangePassword !== undefined) data.mustChangePassword = dto.mustChangePassword;
    const updated = await this.prisma.user.update({ where: { id }, data });
    await this.afterAccessChange(id, dto.isActive === false || dto.role !== undefined || dto.teamId !== undefined);
    await this.audit.log({ actorId: me.id, action: dto.isActive === false ? 'USER_DEACTIVATE' : 'USER_UPDATE', entity: 'user', entityId: id, metadata: dto as any, ip });
    return this.safe(updated);
  }

  /** Issues a one-time temporary password (replaces the insecure public "forgot password" token). */
  async resetPassword(me: RequestUser, id: string, ip?: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');
    this.assertCanManage(me, target);
    const password = tempPassword();
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await argon2.hash(password), mustChangePassword: true } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.afterAccessChange(id, true);
    await this.audit.log({ actorId: me.id, action: 'PASSWORD_RESET_BY_ADMIN', entity: 'user', entityId: id, ip });
    return { email: target.email, displayName: target.displayName, tempPassword: password };
  }

  /** Create many people at once (e.g. 65 interns pasted from a spreadsheet). Returns credentials ONCE. */
  async bulkCreate(me: RequestUser, dto: BulkCreateUsersDto, ip?: string) {
    if (!dto.rows.length) throw new BadRequestException('No rows');
    const [teams, batches] = await Promise.all([
      this.prisma.team.findMany({ select: { id: true, name: true } }),
      this.prisma.batch.findMany({ select: { id: true, name: true } }),
    ]);
    const teamBy = new Map(teams.map((t) => [t.name.trim().toLowerCase(), t.id]));
    const batchBy = new Map(batches.map((b) => [b.name.trim().toLowerCase(), b.id]));
    const existing = new Set(
      (await this.prisma.user.findMany({ where: { email: { in: dto.rows.map((r) => r.email) } }, select: { email: true } })).map((u) => u.email),
    );

    const created: Array<{ email: string; displayName: string; role: string; team: string | null; batch: string | null; tempPassword: string }> = [];
    const skipped: Array<{ email: string; reason: string }> = [];
    const seen = new Set<string>();
    const todo: Array<{ row: (typeof dto.rows)[number]; role: any; teamId: string | null; batchId: string | null }> = [];

    for (const row of dto.rows) {
      if (seen.has(row.email)) { skipped.push({ email: row.email, reason: 'Duplicate in this list' }); continue; }
      seen.add(row.email);
      if (existing.has(row.email)) { skipped.push({ email: row.email, reason: 'Email already exists' }); continue; }
      const role = row.role ?? 'EMPLOYEE';
      if (me.role === 'TEAM_LEAD' && !LEAD_MANAGED_ROLES.includes(role)) { skipped.push({ email: row.email, reason: 'Leads can create coordinators/employees only' }); continue; }
      let teamId = row.team ? teamBy.get(row.team.trim().toLowerCase()) ?? null : null;
      if (row.team && !teamId) { skipped.push({ email: row.email, reason: `Unknown team "${row.team}"` }); continue; }
      if (me.role === 'TEAM_LEAD') {
        if (!me.teamId) { skipped.push({ email: row.email, reason: 'You have no team' }); continue; }
        if (teamId && teamId !== me.teamId) { skipped.push({ email: row.email, reason: 'Other team' }); continue; }
        teamId = me.teamId;
      }
      const batchId = row.batch ? batchBy.get(row.batch.trim().toLowerCase()) ?? null : null;
      if (row.batch && !batchId) { skipped.push({ email: row.email, reason: `Unknown batch "${row.batch}"` }); continue; }
      todo.push({ row, role, teamId, batchId });
    }

    // Hash in small parallel chunks: argon2 is deliberately slow, this keeps 300 rows under ~10s without starving the API.
    for (let i = 0; i < todo.length; i += 6) {
      await Promise.all(
        todo.slice(i, i + 6).map(async ({ row, role, teamId, batchId }) => {
          const pw = tempPassword();
          try {
            await this.prisma.user.create({
              data: { email: row.email, displayName: row.displayName, role, teamId, batchId, passwordHash: await argon2.hash(pw), mustChangePassword: true },
            });
            created.push({
              email: row.email, displayName: row.displayName, role,
              team: teams.find((t) => t.id === teamId)?.name ?? null,
              batch: batches.find((b) => b.id === batchId)?.name ?? null,
              tempPassword: pw,
            });
          } catch {
            skipped.push({ email: row.email, reason: 'Could not create' });
          }
        }),
      );
    }
    await this.audit.log({ actorId: me.id, action: 'USER_BULK_CREATE', entity: 'user', metadata: { created: created.length, skipped: skipped.length }, ip });
    return { created, skipped };
  }

  private async afterAccessChange(userId: string, kickSockets: boolean) {
    this.cache.invalidate(userId);
    if (kickSockets) this.gateway.disconnectUser(userId);
  }

  private safe(u: any) {
    if (!u) return u;
    const { passwordHash: _p, ...rest } = u;
    return rest;
  }
}
