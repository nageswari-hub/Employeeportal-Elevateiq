import { Module } from '@nestjs/common';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { CommsModule } from '../comms/comms.module';

@Module({ imports: [CommsModule], providers: [TicketsService], controllers: [TicketsController] })
export class TicketsModule {}
