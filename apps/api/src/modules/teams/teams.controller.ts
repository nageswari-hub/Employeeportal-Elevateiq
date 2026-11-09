import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { TeamsService } from './teams.service';
import { CreateTeamDto, UpdateTeamDto } from './dto/teams.dto';

@Controller('teams')
export class TeamsController {
  constructor(private teams: TeamsService) {}

  @Get()
  list() {
    return this.teams.list();
  }

  @Get(':id')
  get(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.teams.get(id, me.role);
  }

  @Roles('ADMIN')
  @Post()
  create(@CurrentUser() me: RequestUser, @Body() dto: CreateTeamDto, @Req() req: Request) {
    return this.teams.create(me.id, dto, req.ip);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateTeamDto, @Req() req: Request) {
    return this.teams.update(me.id, id, dto, req.ip);
  }
}
