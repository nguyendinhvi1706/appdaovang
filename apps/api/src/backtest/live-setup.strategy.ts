import { Candle } from '../market/market.service';
import {
  detectEqualLevels, detectFVG, detectOrderBlocks, detectStructure, detectSwings, Swing, Zone,
} from '../smc/smc.engine';

/**
 * Mô phỏng CHÍNH XÁC logic vào lệnh của tính năng "Setup lệnh" (AiService.createSetup) để chạy
 * backtest khách quan trên dữ liệu lịch sử — thứ mà các chiến lược backtest cũ (ema_cross, smc_bos...)
 * KHÔNG làm được vì chúng dùng công thức entry/SL/TP hoàn toàn khác với logic đang chạy thật.
 *
 * Khác biệt có chủ ý so với bản live (đều là đơn giản hoá AN TOÀN, không làm đẹp kết quả):
 *  - Không bù basis (offM = 0): dữ liệu backtest là một chuỗi giá nhất quán, không có chuyện trộn
 *    giá futures với giá spot như khi chạy thật.
 *  - "Giá spot hiện tại" lấy bằng giá đóng cửa của nến cuối cửa sổ, thay vì quote realtime.
 *  - Khung H1 dựng bằng cách gộp 4 nến M15 liên tiếp, thay vì tải riêng chuỗi H1.
 *
 * CHỐNG NHÌN TRƯỚC (lookahead): hàm chỉ nhận cửa sổ nến ĐÃ ĐÓNG tính đến thời điểm quyết định.
 * Mọi phép dò swing/Order Block/FVG đều chạy lại trên đúng cửa sổ đó, nên không thể "biết trước"
 * tương lai — đây là điều kiện bắt buộc để con số winrate có ý nghĩa.
 */

export type LiveSetup = { direction: 'BUY' | 'SELL'; entry: number; sl: number; tp: number; rr: number };

// ---------- Chỉ báo cục bộ (bản backtest, không phụ thuộc AiService) ----------
function atrOf(c: Candle[], period = 14): number | null {
  if (c.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < c.length; i++) {
    trs.push(Math.max(c[i].high - c[i].low, Math.abs(c[i].high - c[i - 1].close), Math.abs(c[i].low - c[i - 1].close)));
  }
  const use = trs.slice(-period);
  return use.reduce((a, b) => a + b, 0) / use.length;
}

function emaOf(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

/** Gộp N nến liên tiếp thành 1 (M15 × 4 = H1) */
function aggregateBy(c: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < c.length; i += factor) {
    const g = c.slice(i, i + factor);
    if (!g.length) break;
    out.push({
      time: g[0].time,
      open: g[0].open,
      high: Math.max(...g.map((x) => x.high)),
      low: Math.min(...g.map((x) => x.low)),
      close: g[g.length - 1].close,
    });
  }
  return out;
}

/** Sóng 3 điểm 0→A→B cho SK System — giữ nguyên quy tắc của bản live */
function pickWave(swings: Swing[], wantKind: 'high' | 'low'): { s0: Swing; sA: Swing; sB: Swing } | null {
  let iB = -1;
  for (let i = swings.length - 1; i >= 0; i--) { if (swings[i].kind === wantKind) { iB = i; break; } }
  if (iB < 0) return null;
  let iA = -1;
  for (let i = iB - 1; i >= 0; i--) { if (swings[i].kind !== wantKind) { iA = i; break; } }
  if (iA < 0) return null;
  let i0 = -1;
  for (let i = iA - 1; i >= 0; i--) { if (swings[i].kind === wantKind) { i0 = i; break; } }
  if (i0 < 0) return null;
  return { s0: swings[i0], sA: swings[iA], sB: swings[iB] };
}

/** Nới SL ra tối thiểu — bản sao quy tắc chống "SL nằm trong biên độ nhiễu" của bản live */
function enforceMinStop(entry: number, sl: number, bull: boolean, minDist: number): number {
  if (Math.abs(entry - sl) >= minDist) return sl;
  return bull ? entry - minDist : entry + minDist;
}

/**
 * Trả về setup (entry/SL/TP/RR) theo đúng thuật toán live, hoặc null nếu "đứng ngoài".
 * @param window nến M15 đã đóng, tính đến thời điểm ra quyết định (nến cuối = hiện tại)
 */
export function decideLiveSetup(window: Candle[], method: 'SMC' | 'SK'): LiveSetup | null {
  if (window.length < 60) return null;
  const m15 = window;
  const spot = m15[m15.length - 1].close;

  const aRef = atrOf(m15) ?? spot * 0.005;
  const minSlDist = Math.max(aRef * 1.5, spot * 0.001);
  const m15Swings = detectSwings(m15);

  // --- Xu hướng H1: ưu tiên BOS/CHOCH gần nhất, thiếu thì dùng EMA20/50 (giống bản live) ---
  const h1 = aggregateBy(m15, 4);
  const h1Swings = detectSwings(h1);
  const h1Structure = detectStructure(h1, h1Swings);
  const lastH1Event = h1Structure[h1Structure.length - 1] ?? null;
  const h1Closes = h1.map((x) => x.close);
  const h1e20 = emaOf(h1Closes, 20);
  const h1e50 = emaOf(h1Closes, 50);
  const h1Trend: 'TĂNG' | 'GIẢM' | null = lastH1Event
    ? (lastH1Event.direction === 'bull' ? 'TĂNG' : 'GIẢM')
    : (h1e20 != null && h1e50 != null ? (h1e20 >= h1e50 ? 'TĂNG' : 'GIẢM') : null);
  if (!h1Trend) return null; // backtest luôn chạy chế độ AUTO (thuận xu hướng)

  const bull = h1Trend === 'TĂNG';
  const direction: 'BUY' | 'SELL' = bull ? 'BUY' : 'SELL';

  if (method === 'SK') {
    // ---- SK System: Fibonacci Retracement 0.618 vào lệnh, 0.786 làm SL, Extension làm TP ----
    const wave = pickWave(m15Swings, bull ? 'low' : 'high');
    if (!wave) return null;
    const validWave = bull ? wave.sB.price > wave.s0.price : wave.sB.price < wave.s0.price;
    if (!validWave) return null;

    const s0P = wave.s0.price, sAP = wave.sA.price, sBP = wave.sB.price;
    const range = Math.abs(sAP - s0P);
    if (range <= 0) return null;
    const fibLevel = (r: number) => (bull ? sAP - r * range : sAP + r * range);

    const entry = fibLevel(0.618);
    const buffer = aRef * 0.5;
    const sl = enforceMinStop(entry, bull ? fibLevel(0.786) - buffer : fibLevel(0.786) + buffer, bull, minSlDist);
    const slDist = Math.abs(entry - sl);
    if (slDist <= 0) return null;

    const ratios = [1.272, 1.382, 1.618, 1.809, 2];
    const minRR = 1.5, maxRR = 5;
    let tp = bull ? entry + slDist * 2.5 : entry - slDist * 2.5;
    for (const r of ratios) {
      const cand = bull ? sBP + r * range : sBP - r * range;
      const candRR = Math.abs(cand - entry) / slDist;
      if (candRR >= minRR && candRR <= maxRR) { tp = cand; break; }
    }

    // Sóng đã bị vô hiệu trước khi kịp vào lệnh
    if (bull ? (spot <= sl || spot >= tp) : (spot >= sl || spot <= tp)) return null;

    return { direction, entry, sl, tp, rr: +(Math.abs(tp - entry) / slDist).toFixed(2) };
  }

  // ---- SMC: chờ retest rìa Order Block (ưu tiên) hoặc FVG gần nhất chưa bị lấp ----
  const minZoneSize = aRef * 0.1;
  const m15Structure = detectStructure(m15, m15Swings);
  const sizeable = (z: Zone) => z.top - z.bottom >= minZoneSize;
  const dirMatch = (z: Zone) => (bull ? z.direction === 'bull' : z.direction === 'bear');
  const zoneDist = (z: Zone) => Math.abs(spot - (bull ? z.top : z.bottom));

  const obs = detectOrderBlocks(m15, m15Structure).filter((z) => !z.mitigated).filter(sizeable);
  const fvgs = detectFVG(m15).filter((z) => !z.mitigated).filter(sizeable);
  const obCand = obs.filter(dirMatch).filter((z) => zoneDist(z) <= aRef * 3).sort((a, b) => zoneDist(a) - zoneDist(b));
  const fvgCand = fvgs.filter(dirMatch).filter((z) => zoneDist(z) <= aRef * 3).sort((a, b) => zoneDist(a) - zoneDist(b));
  const zone = obCand[0] ?? fvgCand[0] ?? null;
  if (!zone) return null;

  const entry = bull ? zone.top : zone.bottom;
  const buffer = aRef * 0.5;
  const sl = enforceMinStop(entry, bull ? zone.bottom - buffer : zone.top + buffer, bull, minSlDist);
  const slDist = Math.abs(entry - sl);
  if (slDist <= 0) return null;

  const minRR = 1.5, maxRR = 5;
  const liquidity = detectEqualLevels(m15, m15Swings);
  const liqInDir = liquidity
    .filter((e) => (bull ? e.price > entry : e.price < entry))
    .map((e) => ({ ...e, dist: Math.abs(e.price - entry) }))
    .sort((a, b) => a.dist - b.dist);
  const qualifying = liqInDir.find((e) => e.dist / slDist >= minRR);
  const tp = qualifying && qualifying.dist / slDist <= maxRR
    ? qualifying.price
    : (bull ? entry + slDist * 2.5 : entry - slDist * 2.5);

  return { direction, entry, sl, tp, rr: +(Math.abs(tp - entry) / slDist).toFixed(2) };
}
