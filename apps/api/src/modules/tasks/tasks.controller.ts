import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { TasksService } from './tasks.service';
import { AddCommentDto, ChangeStatusDto, CreateTaskDto, ListTasksQuery, UpdateTaskDto } from './dto/tasks.dto';

@Controller('tasks')
export class TasksController {
  constructor(private tasks: TasksService) {}

  @Get()
  list(@CurrentUser() me: RequestUser, @Query() q: ListTasksQuery) {
    return this.tasks.list(me, q as any);
  }

  @Get(':id')
  get(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.tasks.get(me, id);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Post()
  create(@CurrentUser() me: RequestUser, @Body() dto: CreateTaskDto, @Req() req: Request) {
    return this.tasks.create(me, dto, req.ip);
  }

  @Patch(':id')
  update(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateTaskDto, @Req() req: Request) {
    return this.tasks.update(me, id, dto, req.ip);
  }

  @Patch(':id/status')
  status(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: ChangeStatusDto, @Req() req: Request) {
    return this.tasks.changeStatus(me, id, dto, req.ip);
  }

  @Delete(':id/series')
  stopSeries(@CurrentUser() me: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.tasks.stopSeries(me, id, req.ip);
  }

  @Delete(':id/attachments/:fileId')
  removeAttachment(@CurrentUser() me: RequestUser, @Param('id') id: string, @Param('fileId') fileId: string, @Req() req: Request) {
    return this.tasks.removeAttachment(me, id, fileId, req.ip);
  }

  @Post(':id/comments')
  comment(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: AddCommentDto) {
    return this.tasks.comment(me, id, dto);
  }
}
