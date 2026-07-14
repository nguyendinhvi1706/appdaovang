import { Candle } from '../market/market.service';

export type Swing = { index: number; time: number; price: number; kind: 'high' | 'low' };
export type StructureEvent = {
  type: 'BOS' | 'CHOCH';
  direction: 'bull' | 'bear';
  time: number;          // nến phá vỡ
  price: number;         // mức swing bị phá
  swingTime: number;     // thời điểm swing bị phá
};
export type Zone = {
  kind: 'OB' | 'FVG';
  direction: 'bull' | 'bear';
  top: number;
  bottom: number;
  fromTime: number;
  toTime: number | null; // null = còn hiệu lực, kéo dài tới hiện tại
  mitigated: boolean;
};
export type EqLevel = { kind: 'EQH' | 'EQL'; price: number; times: number[] };
export type DealingRange = { high: number; low: number; eq: number; fromTime: number };

export function detectSwings(c: Candle[], lb = 2): Swing[] {
  const swings: Swing[] = [];
  for (let i = lb; i < c.length - lb; i++) {
    const win = c.slice(i - lb, i + lb + 1);
    if (c[i].high === Math.max(...win.map((x) => x.high)))
      swings.push({ index: i, time: c[i].time, price: c[i].high, kind: 'high' });
    if (c[i].low === Math.min(...win.map((x) => x.low)))
      swings.push({ index: i, time: c[i].time, price: c[i].low, kind: 'low' });
  }
  return swings.sort((a, b) => a.index - b.index);
}

/** BOS/CHOCH: đóng nến phá swing gần nhất. CHOCH nếu ngược trend hiện tại. */
export function detectStructure(c: Candle[], swings: Swing[]): StructureEvent[] {
  const events: StructureEvent[] = [];
  let trend: 'bull' | 'bear' | null = null;
  let lastHigh: Swing | null = null;
  let lastLow: Swing | null = null;
  let si = 0;

  for (let i = 0; i < c.length; i++) {
    while (si < swings.length && swings[si].index + 2 <= i) {
      const s = swings[si++];
      if (s.kind === 'high') lastHigh = s;
      else lastLow = s;
    }
    if (lastHigh && c[i].close > lastHigh.price) {
      const type = trend === 'bear' ? 'CHOCH' : 'BOS';
      events.push({ type, direction: 'bull', time: c[i].time, price: lastHigh.price, swingTime: lastHigh.time });
      trend = 'bull';
      lastHigh = null;
    }
    if (lastLow && c[i].close < lastLow.price) {
      const type = trend === 'bull' ? 'CHOCH' : 'BOS';
      events.push({ type, direction: 'bear', time: c[i].time, price: lastLow.price, swingTime: lastLow.time });
      trend = 'bear';
      lastLow = null;
    }
  }
  return events;
}

/** Order Block: nến ngược chiều cuối cùng trước cú phá cấu trúc */
export function detectOrderBlocks(c: Candle[], events: StructureEvent[]): Zone[] {
  const zones: Zone[] = [];
  for (const ev of events) {
    const breakIdx = c.findIndex((x) => x.time === ev.time);
    if (breakIdx < 1) continue;
    for (let j = breakIdx - 1; j >= Math.max(0, breakIdx - 10); j--) {
      const bearish = c[j].close < c[j].open;
      if ((ev.direction === 'bull' && bearish) || (ev.direction === 'bear' && !bearish)) {
        const zone: Zone = {
          kind: 'OB', direction: ev.direction,
          top: c[j].high, bottom: c[j].low,
          fromTime: c[j].time, toTime: null, mitigated: false,
        };
        for (let k = breakIdx + 1; k < c.length; k++) {
          const touched = ev.direction === 'bull' ? c[k].low <= zone.top : c[k].high >= zone.bottom;
          if (touched) { zone.mitigated = true; zone.toTime = c[k].time; break; }
        }
        zones.push(zone);
        break;
      }
    }
  }
  return zones.slice(-15);
}

/** Fair Value Gap: khoảng trống 3 nến */
export function detectFVG(c: Candle[]): Zone[] {
  const zones: Zone[] = [];
  for (let i = 2; i < c.length; i++) {
    if (c[i - 2].high < c[i].low) {
      const zone: Zone = { kind: 'FVG', direction: 'bull', top: c[i].low, bottom: c[i - 2].high, fromTime: c[i - 1].time, toTime: null, mitigated: false };
      for (let k = i + 1; k < c.length; k++) {
        if (c[k].low <= zone.bottom) { zone.mitigated = true; zone.toTime = c[k].time; break; }
      }
      zones.push(zone);
    }
    if (c[i - 2].low > c[i].high) {
      const zone: Zone = { kind: 'FVG', direction: 'bear', top: c[i - 2].low, bottom: c[i].high, fromTime: c[i - 1].time, toTime: null, mitigated: false };
      for (let k = i + 1; k < c.length; k++) {
        if (c[k].high >= zone.top) { zone.mitigated = true; zone.toTime = c[k].time; break; }
      }
      zones.push(zone);
    }
  }
  // Ưu tiên FVG chưa lấp
  return [...zones.filter((z) => !z.mitigated).slice(-10), ...zones.filter((z) => z.mitigated).slice(-5)];
}

/** Equal High/Low: các swing bằng nhau trong dung sai → vùng thanh khoản */
export function detectEqualLevels(c: Candle[], swings: Swing[]): EqLevel[] {
  const atr = avgRange(c);
  const tol = atr * 0.25;
  const out: EqLevel[] = [];
  for (const kind of ['high', 'low'] as const) {
    const pts = swings.filter((s) => s.kind === kind);
    const used = new Set<number>();
    for (let i = 0; i < pts.length; i++) {
      if (used.has(i)) continue;
      const group = [pts[i]];
      for (let j = i + 1; j < pts.length; j++) {
        if (!used.has(j) && Math.abs(pts[j].price - pts[i].price) <= tol && pts[j].index - pts[i].index <= 120) {
          group.push(pts[j]); used.add(j);
        }
      }
      if (group.length >= 2) {
        const price = group.reduce((s, g) => s + g.price, 0) / group.length;
        const lastIdx = Math.max(...group.map((g) => g.index));
        const swept = c.slice(lastIdx + 1).some((x) => (kind === 'high' ? x.close > price + tol : x.close < price - tol));
        if (!swept) out.push({ kind: kind === 'high' ? 'EQH' : 'EQL', price: +price.toFixed(4), times: group.map((g) => g.time) });
      }
    }
  }
  return out.slice(-8);
}

export function dealingRange(c: Candle[], swings: Swing[]): DealingRange | null {
  const recent = swings.filter((s) => s.index >= c.length - 120);
  const highs = recent.filter((s) => s.kind === 'high');
  const lows = recent.filter((s) => s.kind === 'low');
  if (!highs.length || !lows.length) return null;
  const hi = highs.reduce((a, b) => (b.price > a.price ? b : a));
  const lo = lows.reduce((a, b) => (b.price < a.price ? b : a));
  return {
    high: hi.price, low: lo.price,
    eq: +((hi.price + lo.price) / 2).toFixed(4),
    fromTime: Math.min(hi.time, lo.time),
  };
}

function avgRange(c: Candle[]): number {
  const n = Math.min(c.length, 50);
  return c.slice(-n).reduce((s, x) => s + (x.high - x.low), 0) / n;
}
