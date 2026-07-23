import { IsEnum, IsIn, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class RunBacktestDto {
  @IsString()
  symbol: string;

  @IsIn(['5m', '15m', '30m', '1h', '4h', '1d'])
  interval: '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

  @IsEnum(['ema_cross', 'rsi_reversion', 'smc_bos', 'cyclical_extreme', 'grid_369'])
  strategy: 'ema_cross' | 'rsi_reversion' | 'smc_bos' | 'cyclical_extreme' | 'grid_369';

  @IsOptional() @Type(() => Number) @IsNumber() @Min(2) @Max(200)
  emaFast = 9;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(3) @Max(400)
  emaSlow = 21;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(2) @Max(50)
  rsiPeriod = 14;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(5) @Max(50)
  rsiLower = 30;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(50) @Max(95)
  rsiUpper = 70;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(2) @Max(50)
  atrPeriod = 14;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.5) @Max(10)
  slAtrMult = 1.5;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.5) @Max(10)
  rr = 2;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.1) @Max(10)
  riskPercent = 1;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(10)
  initialBalance = 1000;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(3) @Max(50)
  fisherPeriod = 10;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.5) @Max(3)
  fisherThreshold = 1.2;

  // Lưới "369" (Tesla numerology) — chu kỳ lặp lại của lưới mốc giá cố định (theo đúng bảng dạy
  // trong tài liệu gốc: mỗi 100 đơn vị giá chia thành 18 mốc theo mẫu offset 3-4-3-10-10) và pha
  // (anchor) để dịch lưới. Test khách quan, không hindsight: tín hiệu chỉ dùng dữ liệu tới nến hiện tại.
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0.0001) @Max(1000000)
  grid369Unit = 100;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(-1000000) @Max(1000000)
  grid369Anchor = 0;
}
