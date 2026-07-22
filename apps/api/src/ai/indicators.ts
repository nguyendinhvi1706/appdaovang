export type Candle = { time: number; open: number; high: number; low: number; close: number };

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return +e.toFixed(4);
}

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(1);
}

export function atr(candles: Candle[], period = 14): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return +(trs.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(4);
}

export type FisherPoint = { time: number; fisher: number; signal: number };
export type CyclicalExtreme = { time: number; type: 'high' | 'low'; fisher: number };

/**
 * Fisher Transform (John Ehlers, "Cybernetic Analysis for Stocks and Futures") — công thức công
 * khai, không phải hộp đen. Chuẩn hóa vị trí giá trong N nến gần nhất về đường cong Gauss, làm
 * NHỌN các điểm đảo chiều theo chu kỳ — rõ ràng và dứt khoát hơn RSI/Stochastic (vốn dễ "phẳng lì"
 * khi giá đi ngang lâu ở vùng quá mua/quá bán). Đây là lấy cảm hứng từ ý tưởng "điểm cực trị theo
 * chu kỳ" kiểu KCX của CRAZII, nhưng công thức hoàn toàn minh bạch, tự kiểm chứng được.
 */
export function fisherTransform(c: Candle[], period = 10): FisherPoint[] {
  const out: FisherPoint[] = [];
  let value = 0;
  let fisher = 0;
  for (let i = 0; i < c.length; i++) {
    if (i < period - 1) {
      out.push({ time: c[i].time, fisher: 0, signal: 0 });
      continue;
    }
    const window = c.slice(i - period + 1, i + 1);
    const hi = Math.max(...window.map((x) => x.high));
    const lo = Math.min(...window.map((x) => x.low));
    const mid = (c[i].high + c[i].low) / 2;
    const raw = hi === lo ? 0 : 2 * ((mid - lo) / (hi - lo) - 0.5);
    value = 0.33 * raw + 0.67 * value;
    value = Math.max(-0.999, Math.min(0.999, value));
    const prevFisher = fisher;
    fisher = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * prevFisher;
    // Đường tín hiệu = Fisher của chính nó, trễ 1 nến (cách dùng chuẩn của Ehlers)
    out.push({ time: c[i].time, fisher: +fisher.toFixed(4), signal: +prevFisher.toFixed(4) });
  }
  return out;
}

/** Điểm cực trị theo chu kỳ: Fisher cắt qua đường tín hiệu NGAY TỪ vùng cực trị (|Fisher| vượt ngưỡng trước khi cắt) */
export function detectCyclicalExtremes(points: FisherPoint[], threshold = 1.2): CyclicalExtreme[] {
  const out: CyclicalExtreme[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev.fisher <= prev.signal && cur.fisher > cur.signal && prev.fisher < -threshold) {
      out.push({ time: cur.time, type: 'low', fisher: cur.fisher }); // cực trị đáy → khả năng đảo chiều tăng
    }
    if (prev.fisher >= prev.signal && cur.fisher < cur.signal && prev.fisher > threshold) {
      out.push({ time: cur.time, type: 'high', fisher: cur.fisher }); // cực trị đỉnh → khả năng đảo chiều giảm
    }
  }
  return out;
}

/** Swing high/low gần nhất làm hỗ trợ/kháng cự thô */
export function swingLevels(candles: Candle[], lookback = 3) {
  const highs: number[] = [], lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const w = candles.slice(i - lookback, i + lookback + 1);
    if (candles[i].high === Math.max(...w.map((c) => c.high))) highs.push(candles[i].high);
    if (candles[i].low === Math.min(...w.map((c) => c.low))) lows.push(candles[i].low);
  }
  return {
    resistances: [...new Set(highs.slice(-5))].sort((a, b) => b - a),
    supports: [...new Set(lows.slice(-5))].sort((a, b) => b - a),
  };
}
