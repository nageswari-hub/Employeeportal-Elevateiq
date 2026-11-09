import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString() @MinLength(3) @MaxLength(200)
  subject!: string;

  @IsString() @MinLength(1) @MaxLength(10000)
  description!: string;

  @IsOptional() @IsIn(['WORK', 'ACCESS', 'ATTENDANCE', 'TECHNICAL', 'OTHER'])
  category?: 'WORK' | 'ACCESS' | 'ATTENDANCE' | 'TECHNICAL' | 'OTHER';

  @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

  /** Route straight to an admin instead of the team lead. */
  @IsOptional() @IsBoolean()
  escalateToAdmin?: boolean;
}

export class UpdateTicketDto {
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

  @IsOptional() @IsString() @MaxLength(5000)
  resolution?: string;

  @IsOptional() @IsString()
  assigneeId?: string;
}

export class AddTicketMessageDto {
  @IsString() @MinLength(1) @MaxLength(5000)
  body!: string;
}
