import { Module } from '@nestjs/common';
import { WorkplaceService } from './workplace.service';
import { WorkplaceController } from './workplace.controller';
import { CommsModule } from '../comms/comms.module';

@Module({ imports: [CommsModule], providers: [WorkplaceService], controllers: [WorkplaceController] })
export class WorkplaceModule {}
