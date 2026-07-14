import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MarketService } from '../market/market.service';
import { dealingRange, detectEqualLevels, detectFVG, detectOrderBlocks, detectStructure, detectSwings } from './smc.engine';

@Injectable()
export class SmcService {
  constructor(private market: MarketService) {}

  async analyze(symbol: string, interval: '5m' | '15m' | '30m' | '1h' | '4h' | '1d') {
    const candles = await this.market.candles(symbol, interval);
    if (candles.length < 30) {
      throw new ServiceUnavailableException(`Không đủ dữ liệu nến cho ${symbol} (${interval}).`);
    }
    const swings = detectSwings(candles);
    const events = detectStructure(candles, swings);
    return {
      symbol: symbol.toUpperCase(),
      interval,
      candles,
      events: events.slice(-20),
      orderBlocks: detectOrderBlocks(candles, events),
      fvgs: detectFVG(candles),
      eqLevels: detectEqualLevels(candles, swings),
      dealingRange: dealingRange(candles, swings),
    };
  }
}
