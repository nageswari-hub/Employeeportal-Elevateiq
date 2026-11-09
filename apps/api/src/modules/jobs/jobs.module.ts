import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CommsModule } from '../comms/comms.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { FilesModule } from '../files/files.module';

@Module({ imports: [CommsModule, AttendanceModule, FilesModule], providers: [JobsService] })
export class JobsModule {}
