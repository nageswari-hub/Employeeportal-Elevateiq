import {
  BadRequestException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UserCacheService } from '../../common/user-cache.service';
import { ReportGateService } from '../../common/report-gate.service';

const ACCESS_MINUTES = 15;
const REFRESH_DAYS = 30; // Stage 3 answer

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function passwordOk(pw: string): boolean {
  return pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

export function authCookies(res: Response, access: string, refresh: string | null, refreshExp: Date | null) {
  const secure = process.env.NODE_ENV === 'production';
  res.cookie('access', access, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: ACCESS_MINUTES * 60 * 1000,
    path: '/',
  });
  if (refresh && refreshExp) {
    res.cookie('refresh', refresh, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      expires: refreshExp,
      path: '/',
    });
  }
}

export function clearAuthCookies(res: Response) {
  res.clearCookie('access', { path: '/' });
  res.clearCookie('refresh', { path: '/' });
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private audit: AuditService,
    private cache: UserCacheService,
    private reportGate: ReportGateService,
  ) {}

  // Verified against when the email is unknown, so response time does not reveal which emails exist.
  private dummyHash: Promise<string> = argon2.hash('timing-equalizer-not-a-real-password');

  private accessToken(userId: string, role: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, role },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: `${ACCESS_MINUTES}m` },
    );
  }

  // Per-account brute-force lock: 8 wrong passwords -> 15 minute pause. Shared office IPs are not punished.
  private fails = new Map<string, { n: number; first: number; until: number }>();
  private static readonly MAX_FAILS = 8;
  private static readonly WINDOW_MS = 15 * 60_000;

  private assertNotLocked(email: string) {
    const f = this.fails.get(email);
    if (f && f.until > Date.now()) {
      throw new HttpException('Too many failed attempts. Try again in a few minutes or ask your admin to reset your password.', 429);
    }
  }

  private recordFail(email: string) {
    const now = Date.now();
    let f = this.fails.get(email);
    if (!f || now - f.first > AuthService.WINDOW_MS) f = { n: 0, first: now, until: 0 };
    f.n++;
    if (f.n >= AuthService.MAX_FAILS) f.until = now + AuthService.WINDOW_MS;
    this.fails.set(email, f);
    if (this.fails.size > 10_000) this.fails.clear();
  }

  async login(email: string, password: string, ip: string | undefined, ua: string | undefined) {
    this.assertNotLocked(email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const hash = user?.passwordHash ?? (await this.dummyHash);
    const ok = await argon2.verify(hash, password).catch(() => false);
    if (!user || !user.isActive || !ok) {
      this.recordFail(email);
      throw new UnauthorizedException('Invalid credentials');
    }
    this.fails.delete(email);

    const access = await this.accessToken(user.id, user.role);
    const rawRefresh = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 3600 * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawRefresh),
        expiresAt,
        ip: ip?.slice(0, 45) ?? null,
        userAgent: ua?.slice(0, 500) ?? null,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actorId: user.id, action: 'LOGIN', entity: 'user', entityId: user.id, ip });
    return { access, rawRefresh, refreshExp: expiresAt, user };
  }

  async refresh(rawRefresh: string | undefined, ip: string | undefined) {
    if (!rawRefresh) throw new UnauthorizedException('Missing refresh token');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawRefresh) } });
    if (!row) throw new UnauthorizedException('Invalid session');
    if (row.revokedAt) {
      // A rotated token showing up again means it was copied. Grace window avoids punishing two tabs refreshing at once.
      if (Date.now() - row.revokedAt.getTime() > 30_000) {
        // Only act once: if this token keeps being replayed by a stale cookie, do not
        // revoke fresh sessions or flood the audit log on every replay (that bug kept
        // signing people out and made the portal look like it was reloading forever).
        const active = await this.prisma.refreshToken.count({
          where: { userId: row.userId, revokedAt: null, expiresAt: { gt: new Date() } },
        });
        if (active > 0) {
          await this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
          await this.audit.log({ actorId: row.userId, action: 'REFRESH_REUSE_DETECTED', entity: 'user', entityId: row.userId, ip });
        }
      }
      throw new UnauthorizedException('Invalid session');
    }
    if (row.expiresAt < new Date()) throw new UnauthorizedException('Invalid session');
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.isActive) throw new UnauthorizedException('Account inactive');

    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    const access = await this.accessToken(user.id, user.role);
    const next = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_DAYS * 24 * 3600 * 1000);
    await this.prisma.refreshToken.create({
      data: { userId: user.id, tokenHash: sha256(next), expiresAt, ip: ip?.slice(0, 45) ?? null },
    });
    return { access, rawRefresh: next, refreshExp: expiresAt, user };
  }

  /**
   * Revokes the session. Enforces the daily-report gate first (still-checked-in people
   * must submit today's report), so the token is only revoked when logout is allowed.
   */
  async logout(rawRefresh: string | undefined, me?: { id: string; role: string }) {
    if (!rawRefresh) return;
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawRefresh) }, select: { userId: true } });
    const userId = me?.id ?? row?.userId;
    let role: string | undefined = me?.role;
    if (userId && !role) {
      role = (await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role ?? undefined;
    }
    if (userId && role) await this.reportGate.assert(userId, role, 'LOG_OUT');
    await this.prisma.refreshToken
      .update({ where: { tokenHash: sha256(rawRefresh) }, data: { revokedAt: new Date() } })
      .catch(() => null);
  }

  async changePassword(userId: string, current: string, next: string, ip?: string) {
    if (!passwordOk(next)) throw new BadRequestException('Password must be 8+ chars with letter and number');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account not found');
    const ok = await argon2.verify(user.passwordHash, current).catch(() => false);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await argon2.hash(next), mustChangePassword: false },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    this.cache.invalidate(userId);
    await this.audit.log({ actorId: userId, action: 'PASSWORD_CHANGE', entity: 'user', entityId: userId, ip });
  }

  /**
   * There is no email system, so the old "return the reset token in the response" design let ANYONE who knew an
   * email take over that account. Now: nothing secret is returned. Admins get a notification and use
   * Users -> Reset password to issue a one-time temporary password.
   */
  async forgot(email: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.isActive) {
      const recent = await this.prisma.notification.count({
        where: { type: 'PASSWORD_RESET_REQUEST', link: `/users?focus=${user.id}`, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } },
      });
      if (recent === 0) {
        const admins = await this.prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } });
        if (admins.length) {
          await this.prisma.notification.createMany({
            data: admins.map((a) => ({
              userId: a.id, type: 'PASSWORD_RESET_REQUEST' as const,
              title: `Password reset requested: ${user.displayName}`,
              body: `${user.email} asked for a password reset. Verify it is really them, then issue a temporary password.`,
              link: `/users?focus=${user.id}`,
            })),
          });
        }
        await this.audit.log({ actorId: user.id, action: 'PASSWORD_RESET_REQUESTED', entity: 'user', entityId: user.id, ip });
      }
    }
    return { ok: true };
  }

  sanitize(user: any) {
    const { passwordHash: _p, ...rest } = user;
    return rest;
  }
}
