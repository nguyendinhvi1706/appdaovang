import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateMt5AccountDto {
  @IsString()
  label: string;

  @IsString()
  login: string;

  @IsString()
  server: string;

  @IsOptional()
  @IsString()
  broker?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  balance?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
