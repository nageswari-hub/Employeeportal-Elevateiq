import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { CommsModule } from '../comms/comms.module';
import { FilesModule } from '../files/files.module';

@Module({ imports: [CommsModule, FilesModule], controllers: [AdminController] })
export class AdminModule {}
