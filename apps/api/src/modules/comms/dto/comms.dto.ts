import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString() @MinLength(1) @MaxLength(200)
  title!: string;

  @IsString() @MinLength(1) @MaxLength(10000)
  body!: string;

  @IsOptional() @IsIn(['COMPANY', 'TEAM', 'BATCH'])
  scope?: 'COMPANY' | 'TEAM' | 'BATCH';

  @IsOptional() @IsString()
  teamId?: string;

  @IsOptional() @IsString()
  batchId?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true })
  fileIds?: string[];
}

export class CreateChannelDto {
  @IsOptional() @IsIn(['COMPANY', 'TEAM', 'BATCH', 'GROUP', 'DM'])
  type?: 'COMPANY' | 'TEAM' | 'BATCH' | 'GROUP' | 'DM';

  @IsOptional() @IsString()
  teamId?: string | null;

  @IsOptional() @IsString()
  batchId?: string;

  /** Required for channels/groups; generated for DMs. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  name?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  /** GROUP members (creator is added automatically) or the single other person for a DM. */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  memberIds?: string[];
}

export class AddChannelMembersDto {
  @IsArray() @ArrayMaxSize(50) @IsString({ each: true })
  userIds!: string[];
}

export class PostMessageDto {
  /** May be empty when the message is only attachments. */
  @IsOptional() @IsString() @MaxLength(4000)
  body?: string;

  /** Client-generated id: makes retries idempotent (a message is never posted twice on a flaky connection). */
  @IsOptional() @IsString() @MaxLength(40)
  clientId?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true })
  fileIds?: string[];
}
