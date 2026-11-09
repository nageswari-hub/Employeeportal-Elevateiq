import { Module } from '@nestjs/common';
import { CommsModule } from '../comms/comms.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({ imports: [CommsModule], controllers: [FilesController], providers: [FilesService], exports: [FilesService] })
export class FilesModule {}
