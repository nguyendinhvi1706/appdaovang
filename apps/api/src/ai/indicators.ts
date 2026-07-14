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
