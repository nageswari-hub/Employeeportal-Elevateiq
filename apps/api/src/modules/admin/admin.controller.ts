import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../comms/realtime.gateway';
import { FilesService } from '../files/files.service';
import { isValidDay, dayRange } from '../../common/time';

@Controller('admin')
@Roles('ADMIN')
export class AdminController {
  constructor(private prisma: PrismaService, private gateway: RealtimeGateway, private files: FilesService) {}

  /** Searchable, paginated audit trail: who did what, when, from where. */
  @Get('audit')
  async audit(
    @Query('page') pageQ?: string, @Query('limit') limitQ?: string,
    @Query('action') action?: string, @Query('entity') entity?: string, @Query('actorId') actorId?: string,
    @Query('from') from?: string, @Query('to') to?: string,
  ) {
    const page = Math.max(1, Number(pageQ) || 1);
    const limit = Math.min(100, Math.max(1, Number(limitQ) || 50));
    const where: any = {};
    if (action) where.action = { contains: action.slice(0, 60).toUpperCase() };
    if (entity) where.entity = entity.slice(0, 60);
    if (actorId) where.actorId = actorId;
    if (from || to) {
      if ((from && !isValidDay(from)) || (to && !isValidDay(to))) throw new BadRequestException('from/to must be YYYY-MM-DD');
      where.createdAt = { ...(from ? { gte: dayRange(from).start } : {}), ...(to ? { lt: dayRange(to).end } : {}) };
    }
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
        include: { actor: { select: { id: true, displayName: true, email: true } } },
      }),
    ]);
    return { data: rows, meta: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  }

  /** Quick health/size snapshot for the admin. */
  @Get('system')
  async system() {
    const [dbSize, users, tasks, reports, audit] = await Promise.all([
      this.prisma.$queryRaw<Array<{ size: bigint }>>`SELECT pg_database_size(current_database()) AS size`,
      this.prisma.user.count(),
      this.prisma.task.count(),
      this.prisma.dailyReport.count(),
      this.prisma.auditLog.count(),
    ]);
    const storage = await this.files.stats();
    const mem = process.memoryUsage();
    return {
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      onlineUsers: this.gateway.onlineCount(),
      dbSizeMb: Math.round(Number(dbSize[0]?.size ?? 0) / 1048576),
      memoryMb: Math.round(mem.rss / 1048576),
      counts: { users, tasks, reports, auditLogs: audit },
      storage,
    };
  }
}
