import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { BulkCreateUsersDto, CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto/users.dto';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Get()
  list(@CurrentUser() me: RequestUser, @Query() q: ListUsersQuery) {
    return this.users.list(me, q);
  }

  @Get(':id')
  get(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.users.get(me, id);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post()
  create(@CurrentUser() me: RequestUser, @Body() dto: CreateUserDto, @Req() req: Request) {
    const ip = req.ip;
    return this.users.create(me, dto, ip);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('bulk')
  bulk(@CurrentUser() me: RequestUser, @Body() dto: BulkCreateUsersDto, @Req() req: Request) {
    return this.users.bulkCreate(me, dto, req.ip);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post(':id/reset-password')
  reset(@CurrentUser() me: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.users.resetPassword(me, id, req.ip);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Patch(':id')
  update(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: Request) {
    const ip = req.ip;
    return this.users.update(me, id, dto, ip);
  }
}
