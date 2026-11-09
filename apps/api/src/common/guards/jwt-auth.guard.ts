import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { IS_PUBLIC_KEY } from '../decorators/roles.decorator';
import { UserCacheService } from '../user-cache.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private jwt: JwtService, private users: UserCacheService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const token: string | undefined = req.cookies?.access ?? this.bearer(req.headers?.authorization);
    if (!token) throw new UnauthorizedException('Not authenticated');

    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch {
      throw new UnauthorizedException('Session expired');
    }

    const user = await this.users.get(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedException('Account inactive');

    req.user = {
      id: user.id, email: user.email, displayName: user.displayName,
      role: user.role, teamId: user.teamId, batchId: user.batchId,
    };

    if (user.mustChangePassword) {
      const path: string = req.path ?? req.url ?? '';
      const allowed =
        path.includes('/auth/change-password') || path.includes('/auth/me') ||
        path.includes('/auth/logout') || path.includes('/healthz');
      if (!allowed) throw new ForbiddenException('PASSWORD_CHANGE_REQUIRED');
    }
    return true;
  }

  private bearer(h?: string): string | undefined {
    if (!h) return undefined;
    const [scheme, token] = h.split(' ');
    return scheme === 'Bearer' && token ? token : undefined;
  }
}
