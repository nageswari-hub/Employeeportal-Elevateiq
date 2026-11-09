import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { GoalsService } from './goals.service';
import { CreateGoalDto, UpdateGoalDto } from './dto/goals.dto';

@Controller('goals')
export class GoalsController {
  constructor(private goals: GoalsService) {}

  @Get()
  list(@CurrentUser() me: RequestUser, @Query('teamId') teamId?: string) {
    return this.goals.list(me, teamId);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Post()
  create(@CurrentUser() me: RequestUser, @Body() dto: CreateGoalDto, @Req() req: Request) {
    return this.goals.create(me, dto, req.ip);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Patch(':id')
  update(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateGoalDto, @Req() req: Request) {
    return this.goals.update(me, id, dto, req.ip);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Delete(':id')
  remove(@CurrentUser() me: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.goals.remove(me, id, req.ip);
  }
}
