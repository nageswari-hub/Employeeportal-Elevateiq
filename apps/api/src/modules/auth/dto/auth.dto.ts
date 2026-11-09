import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

// Policy (Stage 3 answers): Basic 8 chars — min 8, at least 1 letter + 1 number.
export class LoginDto {
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'newPassword must contain at least one letter and one number',
  })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @Transform(({ value }) => String(value ?? '').trim().toLowerCase())
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
