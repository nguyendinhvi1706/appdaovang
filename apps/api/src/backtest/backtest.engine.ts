import { Candle } from '../market/market.service';
import { detectStructure, detectSwings } from '../smc/smc.engine';
import { detectCyclicalExtremes, fisherTransform } from '../ai/indicators';

export type StrategyId = 'ema_cross' | 'rsi_reversion' | 'smc_bos' | 'cyclical_extreme' | 'grid_369';

export type BacktestConfig = {
  strategy: StrategyId;
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
  rsiLower: number;
  rsiUpper: number;
  atrPeriod: number;
  slAtrMult: number;   // SL = ATR × hệ số
  rr: number;          // TP = RR × khoảng SL
  riskPercent: number; // % vốn rủi ro mỗi lệnh
  initialBalance: number;
  fisherPeriod: number;    // Cyclical Extreme (Fisher Transform)
  fisherThreshold: number;
  grid369Unit: number;     // Lưới 369: chu kỳ lặp lại (đơn vị giá, VD 100 cho XAUUSD theo đúng tài liệu gốc)
  grid369Anchor: number;   // Lưới 369: pha dịch lưới
};

export type Trade = {
  direction: 'BUY' | 'SELL';
  entryTime: number; entryPrice: number;
  exitTime: number; exitPrice: number;
  sl: number; tp: number;
  r: number;      // kết quả theo R
  pnl: number;    // USD
  reason: 'TP' | 'SL' | 'END';
};

export type BacktestResult = {
  trades: Trade[];
  equity: { time: number; value: number }[];
  stats: {
    totalTrades: number; wins: number; losses: number;
    winRate: number; netProfit: number; finalBalance: number;
    profitFactor: number | null; expectancyR: number; expectancyUsd: number;
    maxDrawdownPct: number; maxLoseStreak: number;
    avgWinUsd: number; avgLossUsd: number;
  };
};

// ---------- Chỉ báo dạng chuỗi ----------
function emaSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period) return out;
  const k = 2 / (period + 1);
  let e = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = e;
  for (let i = period; i < closes.length; i++) {
    e = closes[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

function rsiSeries(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) avgGain += d; else avgLoss -= d;
  }
  avgGain /= period; avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function atrSeries(c: Candle[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  const trs: number[] = [0];
  for (let i = 1; i < c.length; i++) {
    trs.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  }
  let a = 0;
  for (let i = 1; i <= period && i < trs.length; i++) a += trs[i];
  a /= period;
  if (period < c.length) out[period] = a;
  for (let i = period + 1; i < c.length; i++) {
    a = (a * (period - 1) + trs[i]) / period;
    out[i] = a;
  }
  return out;
}

// ---------- Tín hiệu theo chiến lược ----------
function buildSignals(c: Candle[], cfg: BacktestConfig): ('buy' | 'sell' | null)[] {
  const closes = c.map((x) => x.close);
  const signals: ('buy' | 'sell' | null)[] = new Array(c.length).fill(null);

  if (cfg.strategy === 'ema_cross') {
    const fast = emaSeries(closes, cfg.emaFast);
    const slow = emaSeries(closes, cfg.emaSlow);
    for (let i = 1; i < c.length; i++) {
      if (fast[i - 1] == null || slow[i - 1] == null || fast[i] == null || slow[i] == null) continue;
      if (fast[i - 1]! <= slow[i - 1]! && fast[i]! > slow[i]!) signals[i] = 'buy';
      if (fast[i - 1]! >= slow[i - 1]! && fast[i]! < slow[i]!) signals[i] = 'sell';
    }
  } else if (cfg.strategy === 'rsi_reversion') {
    const rsi = rsiSeries(closes, cfg.rsiPeriod);
    for (let i = 1; i < c.length; i++) {
      if (rsi[i - 1] == null || rsi[i] == null) continue;
      if (rsi[i - 1]! < cfg.rsiLower && rsi[i]! >= cfg.rsiLower) signals[i] = 'buy';
      if (rsi[i - 1]! > cfg.rsiUpper && rsi[i]! <= cfg.rsiUpper) signals[i] = 'sell';
    }
  } else if (cfg.strategy === 'smc_bos') {
    const swings = detectSwings(c);
    const events = detectStructure(c, swings);
    const byTime = new Map(c.map((x, i) => [x.time, i]));
    for (const ev of events) {
      if (ev.type !== 'BOS') continue;
      const i = byTime.get(ev.time);
      if (i != null) signals[i] = ev.direction === 'bull' ? 'buy' : 'sell';
    }
  } else if (cfg.strategy === 'cyclical_extreme') {
    const points = fisherTransform(c, cfg.fisherPeriod);
    const extremes = detectCyclicalExtremes(points, cfg.fisherThreshold);
    const byTime = new Map(c.map((x, i) => [x.time, i]));
    for (const e of extremes) {
      const i = byTime.get(e.time);
      // Cực trị đáy (type 'low') → kỳ vọng đảo chiều tăng → BUY; đỉnh → SELL
      if (i != null) signals[i] = e.type === 'low' ? 'buy' : 'sell';
    }
  } else if (cfg.strategy === 'grid_369') {
    // Lưới "369" — dịch nguyên mẫu số học từ tài liệu gốc (chu kỳ lặp mỗi `grid369Unit` đơn vị giá,
    // 18 mốc/chu kỳ theo đúng khoảng cách 3-4-3-10-10 đã dạy, tỷ lệ theo % của chu kỳ 100 gốc).
    // Test HOÀN TOÀN khách quan: mỗi nến chỉ dùng close nến trước + high/low nến hiện tại (đã đóng),
    // không dùng thông tin tương lai — không vẽ lại sau khi biết kết quả như trong video quảng cáo.
    const unit = cfg.grid369Unit;
    const anchor = cfg.grid369Anchor;
    // 18 offset tương đối (tính theo % của chu kỳ 100 đơn vị) suy ra trực tiếp từ bảng "Điểm gốc /
    // Điểm biên / Vùng giao thoa" trong tài liệu: mẫu khoảng cách lặp lại 3,4,3,10,10 × 4 lần = 100.
    const relOffsets = [0, 3, 7, 10, 20, 30, 33, 37, 40, 50, 60, 63, 67, 70, 80, 90, 93, 97];
    const scale = unit / 100;
    const levelsNear = (price: number): number[] => {
      const base = Math.floor((price - anchor) / unit) * unit + anchor;
      const lv: number[] = [];
      for (const off of relOffsets) {
        lv.push(base - unit + off * scale, base + off * scale, base + unit + off * scale);
      }
      return lv;
    };
    for (let i = 1; i < c.length; i++) {
      const prevClose = c[i - 1].close;
      const { low, high } = c[i];
      const touched = levelsNear(c[i].close).filter((L) => L >= low && L <= high);
      if (!touched.length) continue;
      touched.sort((a, b) => Math.abs(a - prevClose) - Math.abs(b - prevClose));
      const L = touched[0];
      // Giá đi lên chạm mốc từ dưới → mốc đóng vai kháng cự → kỳ vọng đảo chiều giảm (SELL).
      // Giá đi xuống chạm mốc từ trên → mốc đóng vai hỗ trợ → kỳ vọng bật lại tăng (BUY).
      if (prevClose < L) signals[i] = 'sell';
      else if (prevClose > L) signals[i] = 'buy';
    }
  }
  return signals;
}

// ---------- Mô phỏng ----------
export function runBacktest(c: Candle[], cfg: BacktestConfig): BacktestResult {
  const signals = buildSignals(c, cfg);
  const atr = atrSeries(c, cfg.atrPeriod);

  let balance = cfg.initialBalance;
  const trades: Trade[] = [];
  const equity: { time: number; value: number }[] = [{ time: c[0].time, value: balance }];

  type Pos = { direction: 'BUY' | 'SELL'; entryTime: number; entry: number; sl: number; tp: number; riskAmt: number };
  let pos: Pos | null = null;

  const close = (i: number, exitPrice: number, reason: Trade['reason']) => {
    if (!pos) return;
    const slDist = Math.abs(pos.entry - pos.sl);
    const move = pos.direction === 'BUY' ? exitPrice - pos.entry : pos.entry - exitPrice;
    const r = slDist > 0 ? move / slDist : 0;
    const pnl = +(r * pos.riskAmt).toFixed(2);
    balance = +(balance + pnl).toFixed(2);
    trades.push({
      direction: pos.direction, entryTime: pos.entryTime, entryPrice: +pos.entry.toFixed(4),
      exitTime: c[i].time, exitPrice: +exitPrice.toFixed(4),
      sl: +pos.sl.toFixed(4), tp: +pos.tp.toFixed(4),
      r: +r.toFixed(2), pnl, reason,
    });
    equity.push({ time: c[i].time, value: balance });
    pos = null;
  };

  for (let i = 0; i < c.length; i++) {
    if (pos) {
      // Kiểm tra SL trước (bảo thủ) rồi mới TP
      if (pos.direction === 'BUY') {
        if (c[i].low <= pos.sl) { close(i, pos.sl, 'SL'); }
        else if (c[i].high >= pos.tp) { close(i, pos.tp, 'TP'); }
      } else {
        if (c[i].high >= pos.sl) { close(i, pos.sl, 'SL'); }
        else if (c[i].low <= pos.tp) { close(i, pos.tp, 'TP'); }
      }
    }
    if (!pos && signals[i] && i + 1 < c.length && atr[i] != null && balance > 0) {
      const dir = signals[i] === 'buy' ? 'BUY' : 'SELL';
      const entry = c[i + 1].open;
      const slDist = atr[i]! * cfg.slAtrMult;
      const sl = dir === 'BUY' ? entry - slDist : entry + slDist;
      const tp = dir === 'BUY' ? entry + slDist * cfg.rr : entry - slDist * cfg.rr;
      pos = {
        direction: dir, entryTime: c[i + 1].time, entry, sl, tp,
        riskAmt: +(balance * cfg.riskPercent / 100).toFixed(2),
      };
    }
  }
  if (pos) close(c.length - 1, c[c.length - 1].close, 'END');

  // ---------- Thống kê ----------
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  let peak = cfg.initialBalance, maxDD = 0;
  for (const e of equity) {
    peak = Math.max(peak, e.value);
    maxDD = Math.max(maxDD, (peak - e.value) / peak);
  }
  let streak = 0, maxStreak = 0;
  for (const t of trades) {
    streak = t.pnl <= 0 ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
  }

  return {
    trades,
    equity,
    stats: {
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? +((wins.length / trades.length) * 100).toFixed(1) : 0,
      netProfit: +(balance - cfg.initialBalance).toFixed(2),
      finalBalance: balance,
      profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : null,
      expectancyR: trades.length ? +(trades.reduce((s, t) => s + t.r, 0) / trades.length).toFixed(2) : 0,
      expectancyUsd: trades.length ? +(trades.reduce((s, t) => s + t.pnl, 0) / trades.length).toFixed(2) : 0,
      maxDrawdownPct: +(maxDD * 100).toFixed(1),
      maxLoseStreak: maxStreak,
      avgWinUsd: wins.length ? +(grossProfit / wins.length).toFixed(2) : 0,
      avgLossUsd: losses.length ? +(grossLoss / losses.length).toFixed(2) : 0,
    },
  };
}
