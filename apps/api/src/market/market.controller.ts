import { Controller, Get, Param, Query } from '@nestjs/common';
import { MarketService } from './market.service';

@Controller('market')
export class MarketController {
  constructor(private svc: MarketService) {}

  @Get('gold')
  gold() {
    return this.svc.gold();
  }

  @Get('quote/:symbol')
  quote(@Param('symbol') symbol: string) {
    return this.svc.quote(symbol);
  }

  @Get('candles/:symbol')
  candles(@Param('symbol') symbol: string, @Query('interval') interval?: string) {
    const ivs = ['5m', '15m', '30m', '1h', '4h', '1d'];
    const iv = (ivs.includes(interval ?? '') ? interval : '1h') as '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
    return this.svc.candles(symbol, iv);
  }

  /** Chẩn đoán tạm thời: xem trực tiếp Yahoo trả về gì cho từng nguồn nến (spot XAUUSD=X vs
   *  futures GC=F) — dùng để tìm hiểu tại sao nguồn spot thật luôn thất bại. */
  @Get('source/:symbol')
  source(@Param('symbol') symbol: string, @Query('interval') interval?: string) {
    const ivs = ['5m', '15m', '30m', '1h', '4h', '1d'];
    const iv = (ivs.includes(interval ?? '') ? interval : '15m') as '5m' | '15m' | '30m' | '1h' | '4h' | '1d';
    return this.svc.diagnoseCandles(symbol, iv);
  }

  @Get('news')
  news() {
    return this.svc.news();
  }
}
