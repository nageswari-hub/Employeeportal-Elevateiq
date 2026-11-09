import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CheckInDto {
  @IsOptional() @IsIn(['OFFICE', 'REMOTE'])
  mode?: 'OFFICE' | 'REMOTE';

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class CheckOutDto {
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class StartBreakDto {
  @IsIn(['LUNCH', 'TEA', 'PERSONAL', 'OTHER'])
  reason!: 'LUNCH' | 'TEA' | 'PERSONAL' | 'OTHER';

  @IsOptional() @IsString() @MaxLength(300)
  note?: string;
}

export class MarkAttendanceDto {
  @IsString() @MinLength(1)
  userId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  day!: string;

  @IsOptional() @IsIn(['PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE'])
  status?: 'PRESENT' | 'LATE' | 'HALF_DAY' | 'ON_LEAVE';

  @IsOptional() @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  checkIn?: string;

  @IsOptional() @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  checkOut?: string;

  @IsOptional() @IsIn(['OFFICE', 'REMOTE'])
  mode?: 'OFFICE' | 'REMOTE';

  /** Why the record is being changed: mandatory, shown to the person and kept in the audit log. */
  @IsString() @MinLength(3) @MaxLength(500)
  reason!: string;
}
