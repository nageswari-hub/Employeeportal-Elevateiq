import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CachedUser {
  id: string; email: string; displayName: string;
  role: 'ADMIN' | 'TEAM_LEAD' | 'COORDINATOR' | 'EMPLOYEE';
  teamId: string | null; batchId: string | null;
  isActive: boolean; mustChangePassword: boolean;
}

/**
 * Tiny in-process cache so the auth guard does not hit Postgres on every request.
 * TTL is short and every user mutation calls invalidate(), so permission changes apply immediately.
 */
@Injectable()
export class UserCacheService {
  private map = new Map<string, { u: CachedUser | null; exp: number }>();
  private readonly ttlMs = 15_000;

  constructor(private prisma: PrismaService) {}

  async get(id: string): Promise<CachedUser | null> {
    const hit = this.map.get(id);
    const now = Date.now();
    if (hit && hit.exp > now) return hit.u;
    const row = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, displayName: true, role: true, teamId: true, batchId: true, isActive: true, mustChangePassword: true },
    });
    const u = row as CachedUser | null;
    if (this.map.size > 5000) this.map.clear();
    this.map.set(id, { u, exp: now + this.ttlMs });
    return u;
  }

  invalidate(id?: string) {
    if (id) this.map.delete(id);
    else this.map.clear();
  }
}
