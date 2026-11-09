import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { BatchesService } from './batches.service';
import { CreateBatchDto, UpdateBatchDto } from './dto/batches.dto';

@Controller('batches')
export class BatchesController {
  constructor(private batches: BatchesService) {}

  @Get()
  list() {
    return this.batches.list();
  }

  @Get(':id')
  get(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.batches.get(id, me.role);
  }

  @Roles('ADMIN')
  @Post()
  create(@CurrentUser() me: RequestUser, @Body() dto: CreateBatchDto, @Req() req: Request) {
    return this.batches.create(me.id, dto, req.ip);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Patch(':id')
  update(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateBatchDto, @Req() req: Request) {
    return this.batches.update(me.id, id, dto, req.ip);
  }
}
