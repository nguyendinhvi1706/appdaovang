import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BacktestService } from './backtest.service';
import { RunBacktestDto } from './backtest.dto';

@UseGuards(JwtAuthGuard)
@Controller('backtest')
export class BacktestController {
  constructor(private svc: BacktestService) {}

  @Post()
  run(@Body() dto: RunBacktestDto) {
    return this.svc.run(dto);
  }
}
