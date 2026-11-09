import { ArrayMaxSize, IsArray, IsNumber, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  batchId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
}

export class CreateItemDto {
  @IsInt()
  @Min(1)
  @Max(365)
  dayNumber!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(53)
  weekNumber?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  topic!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  practiceTask?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  expectedOutput?: string;
}

export class UpdateItemDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  dayNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(53)
  weekNumber?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  topic?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  practiceTask?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  expectedOutput?: string;
}

export class CreateMaterialDto {
  @IsOptional()
  @IsIn(['LINK', 'DOCUMENT', 'VIDEO', 'OTHER'])
  kind?: 'LINK' | 'DOCUMENT' | 'VIDEO' | 'OTHER';

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  fileKey?: string;
}

export class SetProgressDto {
  @IsOptional()
  isDone?: boolean;
}

export class CreateAssessmentDto {
  @IsString()
  batchId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsIn(['QUIZ', 'TASK_BASED'])
  type?: 'QUIZ' | 'TASK_BASED';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(53)
  weekNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  maxScore?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class CreateQuestionDto {
  @IsString()
  @MinLength(1)
  prompt!: string;

  @IsOptional()
  options?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  correctIndex?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  points?: number;
}

export class SubmitAttemptDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  answers!: Array<number | string | null>;

  /** Question ids aligned with `answers`. When sent, grading matches by id so edits made while someone was
   *  taking the quiz can never shift answers onto the wrong question. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  questionIds?: string[];
}

export class GradeAttemptDto {
  @IsInt()
  @Min(0)
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  remarks?: string;
}

export class SubmitReportDto {
  @IsOptional()
  @IsDateString()
  reportDate?: string;

  @IsString()
  @MinLength(1)
  didToday!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  blockers?: string;

  @IsString()
  @MinLength(1)
  planTomorrow!: string;

  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(24)
  hoursWorked!: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  taskIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  fileIds?: string[];
}

export class UpsertEvaluationDto {
  @IsString()
  batchId!: string;

  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  remarks?: string;

  @IsOptional()
  @IsIn(['NOT_ASSESSED', 'NOT_READY', 'DEVELOPING', 'READY', 'EXCELLENT'])
  readiness?: 'NOT_ASSESSED' | 'NOT_READY' | 'DEVELOPING' | 'READY' | 'EXCELLENT';

  @IsOptional()
  attendancePct?: number;

  @IsOptional()
  taskCompletionPct?: number;

  @IsOptional()
  avgScore?: number;
}
