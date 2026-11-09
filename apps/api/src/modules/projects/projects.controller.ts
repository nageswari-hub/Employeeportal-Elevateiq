import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { ProjectsService } from './projects.service';
import { CreateProjectDto, UpdateProjectDto } from './dto/projects.dto';

@Controller('projects')
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() me: RequestUser) {
    return this.projects.list(me);
  }

  @Get(':id')
  get(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.projects.get(me, id);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Post()
  create(@CurrentUser() me: RequestUser, @Body() dto: CreateProjectDto, @Req() req: Request) {
    return this.projects.create(me, dto, req.ip);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Patch(':id')
  update(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateProjectDto, @Req() req: Request) {
    return this.projects.update(me, id, dto, req.ip);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Delete(':id')
  remove(@CurrentUser() me: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.projects.remove(me, id, req.ip);
  }
}
