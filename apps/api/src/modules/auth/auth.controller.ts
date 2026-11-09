import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService, authCookies, clearAuthCookies } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto } from './dto/auth.dto';
import { Public } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService) {}

  private ip(req: Request): string | undefined {
    return req.ip;
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } }) // per IP; offices share one address. Real protection = per-account lock in AuthService
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { access, rawRefresh, refreshExp, user } = await this.auth.login(
      dto.email, dto.password, this.ip(req), req.headers['user-agent'],
    );
    authCookies(res, access, rawRefresh, refreshExp);
    return { user: this.auth.sanitize(user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { access, rawRefresh, refreshExp, user } = await this.auth.refresh(req.cookies?.refresh, this.ip(req));
      authCookies(res, access, rawRefresh, refreshExp);
      return { user: this.auth.sanitize(user) };
    } catch (e) {
      // The session is unusable. Drop the stale cookies so the browser stops
      // replaying the same dead refresh token on every page load (which used to
      // trigger reuse-detection over and over and bounce people back to /login).
      clearAuthCookies(res);
      throw e;
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @CurrentUser() me: RequestUser) {
    await this.auth.logout(req.cookies?.refresh, me);
    clearAuthCookies(res);
    return { ok: true };
  }

  @Get('me')
  async me(@CurrentUser() u: RequestUser) {
    const user = await this.prisma.user.findUnique({ where: { id: u.id } });
    return this.auth.sanitize(user);
  }

  @Post('change-password')
  @HttpCode(200)
  async change(@CurrentUser() u: RequestUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    await this.auth.changePassword(u.id, dto.currentPassword, dto.newPassword, this.ip(req));
    return { ok: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgot(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    await this.auth.forgot(dto.email, this.ip(req));
    // Same answer whether or not the account exists. No token is ever returned.
    return { message: 'If that account exists, your administrator has been notified and will contact you with a temporary password.' };
  }
}
