import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { TicketsService } from './tickets.service';
import { AddTicketMessageDto, CreateTicketDto, UpdateTicketDto } from './dto/tickets.dto';

@Controller('tickets')
export class TicketsController {
  constructor(private tickets: TicketsService) {}

  @Get()
  list(@CurrentUser() me: RequestUser, @Query('status') status?: string) {
    return this.tickets.list(me, { status });
  }

  @Get(':id')
  get(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.tickets.get(me, id);
  }

  @Post()
  create(@CurrentUser() me: RequestUser, @Body() dto: CreateTicketDto, @Req() req: Request) {
    return this.tickets.create(me, dto, req.ip);
  }

  @Patch(':id')
  update(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateTicketDto, @Req() req: Request) {
    return this.tickets.update(me, id, dto, req.ip);
  }

  @Post(':id/messages')
  addMessage(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: AddTicketMessageDto) {
    return this.tickets.addMessage(me, id, dto);
  }
}
