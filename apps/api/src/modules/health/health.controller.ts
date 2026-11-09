import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private prisma: PrismaService) {}

  /** 200 only when the database answers; 503 otherwise so Docker/uptime monitors see real outages. */
  @Public()
  @Get('healthz')
  async health() {
    const t0 = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'degraded', db: 'down' });
    }
    return { status: 'ok', db: 'up', dbMs: Date.now() - t0, uptimeSec: Math.round(process.uptime()), time: new Date().toISOString() };
  }
}
