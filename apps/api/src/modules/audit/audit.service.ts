import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async log(params: {
    actorId?: string | null;
    action: string;
    entity: string;
    entityId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  }) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: params.actorId ?? null,
          action: params.action.slice(0, 60),
          entity: params.entity.slice(0, 60),
          entityId: params.entityId?.slice(0, 100) ?? null,
          metadata: (params.metadata ?? {}) as any,
          ip: params.ip?.slice(0, 45) ?? null,
        },
      });
    } catch {
      // audit must never break the request
    }
  }
}
