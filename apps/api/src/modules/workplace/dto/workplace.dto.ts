import { ArrayMaxSize, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateMeetingDto {
  @IsOptional()
  @IsString()
  teamId?: string | null;

  /** Who should attend. Defaults to TEAM when a teamId is given, otherwise COMPANY. */
  @IsOptional()
  @IsIn(['COMPANY', 'TEAM', 'LEADS', 'USERS'])
  audience?: 'COMPANY' | 'TEAM' | 'LEADS' | 'USERS';

  /** Required for audience = USERS. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  userIds?: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(2000)
  meetUrl!: string;

  @IsDateString()
  startsAt!: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsIn(['NONE', 'DAILY'])
  recurrence?: 'NONE' | 'DAILY';
}

export class RequestLeaveDto {
  @IsDateString()
  fromDate!: string;

  @IsDateString()
  toDate!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason!: string;
}

export class UpdateMeetingNoteDto {
  @IsString()
  @MaxLength(10000)
  note!: string;
}

export class DecideLeaveDto {  @IsOptional()
  @IsIn(['APPROVED', 'REJECTED'])
  decision?: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
