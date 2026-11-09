import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';
import { AnnouncementsService } from './announcements.service';
import { ChannelsService } from './channels.service';
import { RealtimeGateway } from './realtime.gateway';
import { CommsController } from './comms.controller';

@Module({
  imports: [JwtModule.register({})],
  providers: [NotificationsService, AnnouncementsService, ChannelsService, RealtimeGateway],
  controllers: [CommsController],
  exports: [NotificationsService, RealtimeGateway],
})
export class CommsModule {}
