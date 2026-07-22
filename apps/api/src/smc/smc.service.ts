import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MarketService } from '../market/market.service';
import { dealingRange, detectEqualLevels, detectFVG, detectOrderBlocks, detectStructure, detectSwings } from './smc.engine';
import { detectCyclicalExtremes, fisherTransform } from '../ai/indicators';

const FISHER_PERIOD = 10;
const FISHER_THRESHOLD = 1.2;

@Injectable()
export class SmcService {
  constructor(private market: MarketService) {}

  async analyze(symbol: string, interval: '5m' | '15m' | '30m' | '1h' | '4h' | '1d') {
    let candles = await this.market.candles(symbol, interval);
    if (candles.length < 30) {
      throw new ServiceUnavailableException(`Không đủ dữ liệu nến cho ${symbol} (${interval}).`);
    }

    // Hiệu chỉnh theo giá spot: nguồn futures (GC=F) lệch spot một khoảng basis cố định —
    // dịch đều toàn bộ nến để mức giá khớp TradingView, cấu trúc không đổi.
    const spot = await this.market.quote(symbol).catch(() => null);
    let offset = 0;
    if (spot?.price != null) {
      const last = candles[candles.length - 1].close;
      const raw = spot.price - last;
      if (Math.abs(raw) / spot.price > 0.0005) {
        offset = +raw.toFixed(4);
        candles = candles.map((c) => ({
          time: c.time,
          open: +(c.open + offset).toFixed(4),
          high: +(c.high + offset).toFixed(4),
          low: +(c.low + offset).toFixed(4),
          close: +(c.close + offset).toFixed(4),
        }));
      }
    }
    const swings = detectSwings(candles);
    const events = detectStructure(candles, swings);
    const fisher = fisherTransform(candles, FISHER_PERIOD);
    return {
      symbol: symbol.toUpperCase(),
      interval,
      candles,
      events: events.slice(-20),
      orderBlocks: detectOrderBlocks(candles, events),
      fvgs: detectFVG(candles),
      eqLevels: detectEqualLevels(candles, swings),
      dealingRange: dealingRange(candles, swings),
      fisher,
      cyclicalExtremes: detectCyclicalExtremes(fisher, FISHER_THRESHOLD).slice(-20),
      fisherThreshold: FISHER_THRESHOLD,
      spot: spot?.price ?? null,
      offset,
    };
  }
}
