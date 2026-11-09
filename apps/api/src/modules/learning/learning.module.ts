import { Module } from '@nestjs/common';
import { LearningService } from './learning.service';
import { LearningController } from './learning.controller';
import { CommsModule } from '../comms/comms.module';

@Module({ imports: [CommsModule], providers: [LearningService], controllers: [LearningController] })
export class LearningModule {}
