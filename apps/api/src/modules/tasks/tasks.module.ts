import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { CommsModule } from '../comms/comms.module';

@Module({ imports: [CommsModule], providers: [TasksService], controllers: [TasksController] })
export class TasksModule {}
