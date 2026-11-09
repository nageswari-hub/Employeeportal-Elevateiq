import { Global, Module } from '@nestjs/common';
import { UserCacheService } from './user-cache.service';
import { WorkCalendarService } from './work-calendar.service';
import { FileLinkService } from './file-links.service';
import { ReportGateService } from './report-gate.service';
import { MailService } from './mail.service';

@Global()
@Module({
  providers: [UserCacheService, WorkCalendarService, FileLinkService, ReportGateService, MailService],
  exports: [UserCacheService, WorkCalendarService, FileLinkService, ReportGateService, MailService],
})
export class CommonModule {}
