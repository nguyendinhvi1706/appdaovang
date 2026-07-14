import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { BacktestController } from './backtest.controller';
import { BacktestService } from './backtest.service';

@Module({
  imports: [MarketModule],
  controllers: [BacktestController],
  providers: [BacktestService],
})
export class BacktestModule {}
