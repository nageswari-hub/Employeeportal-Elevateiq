import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CommsModule } from '../comms/comms.module';

@Module({ imports: [CommsModule], providers: [UsersService], controllers: [UsersController] })
export class UsersModule {}
