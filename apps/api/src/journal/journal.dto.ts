import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateJournalDto {
  @IsString()
  symbol: string;

  @IsEnum(['BUY', 'SELL'])
  direction: 'BUY' | 'SELL';

  @Type(() => Number)
  @IsNumber()
  entryPrice: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  exitPrice?: number;

  @Type(() => Number)
  @IsNumber()
  lotSize: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  stopLoss?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  takeProfit?: number;

  @IsOptional()
  @IsEnum(['WIN', 'LOSS', 'BREAKEVEN', 'OPEN'])
  result?: 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pnl?: number;

  @IsOptional()
  @IsString()
  emotion?: string;

  @IsOptional()
  @IsString()
  mistakes?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
