import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  goalId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsString()
  ownerId!: string;

  @IsString()
  teamId!: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsIn(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'])
  recurrence?: 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

  /** Last day an occurrence may fall on. Defaults to 30 days after the first due date (max 90). */
  @IsOptional()
  @IsDateString()
  recurrenceUntil?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  estimatedHours?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  collaboratorIds?: string[];
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

  @IsOptional()
  @IsDateString()
  dueDate?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  estimatedHours?: number | null;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class ChangeStatusDto {
  @IsIn(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED'])
  status!: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  blockedReason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reviewNote?: string;
}

export class AddCommentDto {
  /** May be empty when the comment is only attachments. */
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  fileIds?: string[];
}

export class ListTasksQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  ownerId?: string;

  @IsOptional()
  @IsString()
  teamId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['true'])
  overdue?: string;
}
