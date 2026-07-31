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

    // ---- Kiểm chứng ngoài mẫu: chia đôi theo THỜI GIAN ----
    // Đây là hàng rào chống tự lừa mình quan trọng nhất. Nếu một chiến lược (hoặc một lần "điều
    // chỉnh tham số") chỉ ăn may trên dữ liệu quá khứ, nó sẽ đẹp ở nửa đầu và sụp ở nửa sau. Lợi thế
    // thật thì phải xuất hiện ở CẢ HAI nửa. Chỉ nhìn kết quả tổng là cách chắc chắn để bị đánh lừa.
    const mid = from + (to - from) / 2;
    const half = (list: typeof result.trades) => {
      if (list.length < 2) return { trades: list.length, winRate: 0, expectancyR: 0, profitFactor: null as number | null };
      const w = list.filter((t) => t.pnl > 0);
      const gp = w.reduce((s, t) => s + t.pnl, 0);
      const gl = Math.abs(list.filter((t) => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
      return {
        trades: list.length,
        winRate: +((w.length / list.length) * 100).toFixed(1),
        expectancyR: +(list.reduce((s, t) => s + t.r, 0) / list.length).toFixed(3),
        profitFactor: gl > 0 ? +(gp / gl).toFixed(2) : null,
      };
    };
    const split = {
      firstHalf: half(result.trades.filter((t) => t.entryTime < mid)),
      secondHalf: half(result.trades.filter((t) => t.entryTime >= mid)),
    };
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
      split,
      ...result,
    };
  }
}
