import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { MarketService } from '../market/market.service';
import { runBacktest } from './backtest.engine';
import { RunBacktestDto } from './backtest.dto';

@Injectable()
export class BacktestService {
  constructor(private market: MarketService) {}

  async run(dto: RunBacktestDto) {
    // Dữ liệu SÂU (nhiều tháng/năm) thay vì 500 nến: cỡ mẫu nhỏ là lý do khiến mọi kết quả backtest
    // trước đây vô nghĩa về mặt thống kê (2-9 lệnh mỗi lần chạy, khoảng tin cậy chứa cả số 0).
    const maxBars = dto.maxBars ?? 20000;
    const candles = await this.market.deepCandles(dto.symbol, dto.interval, maxBars);
    if (candles.length < 60) {
      throw new ServiceUnavailableException(`Không đủ dữ liệu nến cho ${dto.symbol} (${dto.interval}).`);
    }
    const result = runBacktest(candles, dto);

    const from = candles[0].time, to = candles[candles.length - 1].time;
    const days = Math.round((to - from) / 86400);
    // Chỉ trả tối đa 3000 nến về giao diện để chart không quá nặng — thống kê vẫn tính trên toàn bộ
    const forChart = candles.length > 3000 ? candles.slice(-3000) : candles;

    return {
      symbol: dto.symbol.toUpperCase(),
      interval: dto.interval,
      candleCount: candles.length,
      periodDays: days,
      periodFrom: from,
      periodTo: to,
      candles: forChart,
      ...result,
    };
  }
}
