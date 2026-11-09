import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGoalDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsIn(['WEEKLY', 'MONTHLY', 'CUSTOM'])
  type?: 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'DONE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'DONE' | 'ARCHIVED';
}
