import { Module } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { ExportsService } from './exports.service';
import { InsightsController } from './insights.controller';

@Module({ providers: [InsightsService, ExportsService], controllers: [InsightsController] })
export class InsightsModule {}
