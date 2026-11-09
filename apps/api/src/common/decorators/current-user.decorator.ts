import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestUser {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'TEAM_LEAD' | 'COORDINATOR' | 'EMPLOYEE';
  teamId: string | null;
  batchId: string | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as RequestUser;
  },
);
