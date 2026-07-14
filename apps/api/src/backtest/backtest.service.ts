import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MarketService } from '../market/market.service';
import { runBacktest } from './backtest.engine';
import { RunBacktestDto } from './backtest.dto';

@Injectable()
export class BacktestService {
  constructor(private market: MarketService) {}

  async run(dto: RunBacktestDto) {
    const candles = await this.market.candles(dto.symbol, dto.interval);
    if (candles.length < 60) {
      throw new ServiceUnavailableException(`Không đủ dữ liệu nến cho ${dto.symbol} (${dto.interval}).`);
    }
    const result = runBacktest(candles, dto);
    return { symbol: dto.symbol.toUpperCase(), interval: dto.interval, candleCount: candles.length, candles, ...result };
  }
}
