import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsString()
  teamId?: string;

  @IsOptional() @IsString()
  batchId?: string;

  @IsOptional() @IsString()
  ownerId?: string;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  dueDate?: string;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120)
  name?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string;

  @IsOptional() @IsIn(['ACTIVE', 'PAUSED', 'DONE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'PAUSED' | 'DONE' | 'ARCHIVED';

  @IsOptional() @IsString()
  ownerId?: string;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsDateString()
  dueDate?: string;
}
