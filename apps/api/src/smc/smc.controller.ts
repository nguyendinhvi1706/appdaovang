import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SmcService } from './smc.service';

const INTERVALS = ['5m', '15m', '30m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

@UseGuards(JwtAuthGuard)
@Controller('smc')
export class SmcController {
  constructor(private svc: SmcService) {}

  @Get(':symbol')
  analyze(@Param('symbol') symbol: string, @Query('interval') interval?: string) {
    const iv: Interval = INTERVALS.includes(interval as Interval) ? (interval as Interval) : '1h';
    return this.svc.analyze(symbol, iv);
  }
}
