import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export const SHARED_TYPES = ['STRATEGY', 'TEMPLATE', 'INDICATOR', 'JOURNAL', 'BACKTEST'] as const;
export type SharedTypeVal = (typeof SHARED_TYPES)[number];

export class PublishDto {
  @IsEnum(SHARED_TYPES)
  type: SharedTypeVal;

  @IsString()
  @MaxLength(150)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @MaxLength(50000)
  content: string;
}
