import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateUserDto {
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail()
  @MaxLength(255)
  email!: string;

  /** Optional: when omitted the server generates a one-time temporary password and returns it once. */
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, { message: 'password must contain letter and number' })
  password?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @IsIn(['ADMIN', 'TEAM_LEAD', 'COORDINATOR', 'EMPLOYEE'])
  role!: 'ADMIN' | 'TEAM_LEAD' | 'COORDINATOR' | 'EMPLOYEE';

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'TEAM_LEAD', 'COORDINATOR', 'EMPLOYEE'])
  role?: 'ADMIN' | 'TEAM_LEAD' | 'COORDINATOR' | 'EMPLOYEE';

  @IsOptional()
  @IsString()
  teamId?: string | null;

  @IsOptional()
  @IsString()
  batchId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  mustChangePassword?: boolean;
}

export class ListUsersQuery {
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => (value === undefined ? undefined : Number(value)))
  limit?: number = 20;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'TEAM_LEAD', 'COORDINATOR', 'EMPLOYEE'])
  role?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;
}

export class BulkUserRow {
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @IsOptional()
  @IsIn(['TEAM_LEAD', 'COORDINATOR', 'EMPLOYEE'])
  role?: 'TEAM_LEAD' | 'COORDINATOR' | 'EMPLOYEE';

  /** Team / batch referenced by NAME so a spreadsheet can be pasted straight in. */
  @IsOptional() @IsString() @MaxLength(120) team?: string;
  @IsOptional() @IsString() @MaxLength(120) batch?: string;
}

export class BulkCreateUsersDto {
  @IsArray()
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => BulkUserRow)
  rows!: BulkUserRow[];
}

export class ListUsersQueryExt {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}
