import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateBatchDto, UpdateBatchDto } from './dto/batches.dto';

@Injectable()
export class BatchesService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  list() {
    return this.prisma.batch.findMany({ orderBy: { startDate: 'desc' } });
  }

  async get(id: string, viewerRole: string = 'ADMIN') {
    const staff = viewerRole !== 'EMPLOYEE';
    const b = await this.prisma.batch.findUnique({
      where: { id },
      include: { members: { select: { id: true, displayName: true, email: staff, role: true } } },
    });
    if (!b) throw new NotFoundException('Batch not found');
    return b;
  }

  async create(meId: string, dto: CreateBatchDto, ip?: string) {
    if (new Date(dto.endDate) < new Date(dto.startDate)) throw new BadRequestException('endDate must be >= startDate');
    const b = await this.prisma.batch.create({
      data: {
        name: dto.name,
        description: dto.description ?? null,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        durationDays: dto.durationDays,
        leadId: dto.leadId ?? null,
        coordinatorId: dto.coordinatorId ?? null,
        createdById: meId,
      },
    });
    await this.prisma.channel.create({
      data: { type: 'BATCH', batchId: b.id, name: b.name.slice(0, 80), createdById: meId },
    }).catch(() => { /* channel can also be created lazily on first chat load */ });
    await this.audit.log({ actorId: meId, action: 'BATCH_CREATE', entity: 'batch', entityId: b.id, ip });
    return b;
  }

  async update(meId: string, id: string, dto: UpdateBatchDto, ip?: string) {
    const cur = await this.get(id);
    const start = dto.startDate ? new Date(dto.startDate) : cur.startDate;
    const end = dto.endDate ? new Date(dto.endDate) : cur.endDate;
    if (end < start) throw new BadRequestException('endDate must be >= startDate');
    const b = await this.prisma.batch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.startDate ? { startDate: start } : {}),
        ...(dto.endDate ? { endDate: end } : {}),
        ...(dto.durationDays !== undefined ? { durationDays: dto.durationDays } : {}),
        ...(dto.leadId !== undefined ? { leadId: dto.leadId } : {}),
        ...(dto.coordinatorId !== undefined ? { coordinatorId: dto.coordinatorId } : {}),
      },
    });
    await this.audit.log({ actorId: meId, action: 'BATCH_UPDATE', entity: 'batch', entityId: id, metadata: dto as any, ip });
    return b;
  }
}
