import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export const MARKET_CATEGORIES = ['INDICATOR', 'EA', 'TEMPLATE', 'SCRIPT', 'AI_PROMPT', 'JOURNAL'] as const;
export type MarketCategoryVal = (typeof MARKET_CATEGORIES)[number];

export class CreateItemDto {
  @IsEnum(MARKET_CATEGORIES)
  category: MarketCategoryVal;

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

  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;
}
