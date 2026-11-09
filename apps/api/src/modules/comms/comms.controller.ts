import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { RealtimeGateway } from './realtime.gateway';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { AnnouncementsService } from './announcements.service';
import { ChannelsService } from './channels.service';
import { NotificationsService } from './notifications.service';
import { AddChannelMembersDto, CreateAnnouncementDto, CreateChannelDto, PostMessageDto } from './dto/comms.dto';

@Controller()
export class CommsController {
  constructor(
    private announcements: AnnouncementsService,
    private channels: ChannelsService,
    private notifications: NotificationsService,
    private gateway: RealtimeGateway,
  ) {}

  private ip(req: Request) {
    return req.ip;
  }

  // ----- announcements -----
  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Post('announcements')
  postAnnouncement(@CurrentUser() me: RequestUser, @Body() dto: CreateAnnouncementDto, @Req() req: Request) {
    return this.announcements.create(me, dto, this.ip(req));
  }

  @Get('announcements')
  feed(@CurrentUser() me: RequestUser) {
    return this.announcements.feed(me);
  }

  @Delete('announcements/:id')
  deleteAnnouncement(@CurrentUser() me: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.announcements.remove(me, id, this.ip(req));
  }

  // ----- channels -----
  @Get('channels')
  listChannels(@CurrentUser() me: RequestUser, @Query('teamId') teamId?: string) {
    return this.channels.list(me, teamId);
  }

  @Post('channels')
  createChannel(@CurrentUser() me: RequestUser, @Body() dto: CreateChannelDto) {
    return this.channels.create(me, dto);
  }

  @Get('channels-unread')
  unread(@CurrentUser() me: RequestUser) {
    return this.channels.totalUnread(me);
  }

  @Get('channels/contacts')
  contacts(@CurrentUser() me: RequestUser) {
    return this.channels.contacts(me);
  }

  @Post('channels/:id/members')
  addMembers(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: AddChannelMembersDto) {
    return this.channels.addMembers(me, id, dto.userIds);
  }

  @Delete('channels/:id/members/:userId')
  removeMember(@CurrentUser() me: RequestUser, @Param('id') id: string, @Param('userId') userId: string) {
    return this.channels.removeMember(me, id, userId);
  }

  @Get('channels/:id/messages')
  messages(@CurrentUser() me: RequestUser, @Param('id') id: string, @Query('limit') limit?: string, @Query('before') before?: string, @Query('after') after?: string) {
    return this.channels.messages(me, id, { limit: limit ? Number(limit) : undefined, before, after });
  }

  // 30 messages / minute / person: plenty for humans, stops a stuck client or script from flooding a channel
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('channels/:id/messages')
  post(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: PostMessageDto) {
    return this.channels.post(me, id, dto);
  }

  @Delete('channels/:id/messages/:messageId')
  deleteMessage(@CurrentUser() me: RequestUser, @Param('id') id: string, @Param('messageId') messageId: string) {
    return this.channels.remove(me, id, messageId);
  }

  @Post('channels/:id/read')
  markRead(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.channels.markRead(me, id);
  }

  @Get('presence')
  presence() {
    return { online: this.gateway.onlineIds() };
  }

  // ----- notifications -----
  @Get('notifications')
  notifs(@CurrentUser() me: RequestUser, @Query('unread') unread?: string) {
    return this.notifications.list(me, { unread });
  }

  @Post('notifications/:id/read')
  read(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.notifications.markRead(me, id);
  }

  @Post('notifications/read-all')
  readAll(@CurrentUser() me: RequestUser) {
    return this.notifications.markAllRead(me);
  }
}
