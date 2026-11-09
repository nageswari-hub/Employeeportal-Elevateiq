import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limit per signed-in user (falls back to client IP for anonymous calls).
 * Offices often share ONE public IP, so IP-only limits would throttle the whole team together.
 * Must be registered AFTER JwtAuthGuard so req.user is populated.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id ?? req.ip;
  }
}
