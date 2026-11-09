import { Module } from '@nestjs/common';
import { CommsModule } from '../comms/comms.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({ imports: [CommsModule], controllers: [AttendanceController], providers: [AttendanceService], exports: [AttendanceService] })
export class AttendanceModule {}
