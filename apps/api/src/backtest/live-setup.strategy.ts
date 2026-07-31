import { Candle } from '../market/market.service';
import {
  dealingRange, detectEqualLevels, detectFVG, detectOrderBlocks, detectStructure, detectSwings, Swing, Zone,
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
 * ================== ICT (Inner Circle Trader) ==================
 * Khác biệt CỐT LÕI so với SMC ở trên: SMC chờ giá quay lại chạm rìa Order Block/FVG (mua vào vùng
 * "tổ chức đã để lại dấu"). ICT làm ngược: chờ giá QUÉT THỦNG đáy/đỉnh cũ để gom thanh khoản (stop
 * hunt) rồi bật ngược trở lại — tức vào lệnh SAU khi lệnh cắt lỗ của đám đông vừa bị quét sạch.
 *
 * Ba thành phần ICT mà bản SMC hiện tại KHÔNG có:
 *  1. Liquidity sweep: nến thủng swing low/high cũ nhưng ĐÓNG CỬA trở lại bên trong → tín hiệu quét.
 *  2. Killzone: chỉ giao dịch trong giờ London (07-10 UTC) hoặc New York (12-15 UTC) — khung giờ có
 *     thanh khoản và biến động thật, tránh phiên Á lình xình.
 *  3. Premium/Discount: chỉ BUY khi giá ở nửa DƯỚI, chỉ SELL khi ở nửa TRÊN của dealing range.
 *     (Engine đã có sẵn dealingRange nhưng nhánh SMC chưa hề dùng — đây là thiếu sót thật.)
 *
 * Entry dùng OTE (Optimal Trade Entry) 0.705 — mốc hồi quy kinh điển của ICT, cùng họ với 0.618 mà
 * SK System đang dùng.
 */
function inKillzone(timeSec: number): boolean {
  const h = new Date(timeSec * 1000).getUTCHours();
  return (h >= 7 && h < 10) || (h >= 12 && h < 15);
}

export function decideIctSetup(window: Candle[]): LiveSetup | null {
  if (window.length < 60) return null;
  const m15 = window;
  const last = m15[m15.length - 1];
  const spot = last.close;
  if (!inKillzone(last.time)) return null; // ngoài killzone → đứng ngoài

  const aRef = atrOf(m15) ?? spot * 0.005;
  const minSlDist = Math.max(aRef * 1.5, spot * 0.001);
  const swings = detectSwings(m15);
  if (swings.length < 4) return null;

  // --- Xu hướng khung lớn (H1) làm thiên hướng, giống các phương pháp khác ---
  const h1 = aggregateBy(m15, 4);
  const h1Structure = detectStructure(h1, detectSwings(h1));
  const lastH1Event = h1Structure[h1Structure.length - 1] ?? null;
  const h1Closes = h1.map((x) => x.close);
  const e20 = emaOf(h1Closes, 20), e50 = emaOf(h1Closes, 50);
  const trend = lastH1Event
    ? (lastH1Event.direction === 'bull' ? 'TĂNG' : 'GIẢM')
    : (e20 != null && e50 != null ? (e20 >= e50 ? 'TĂNG' : 'GIẢM') : null);
  if (!trend) return null;
  const bull = trend === 'TĂNG';

  // --- Lọc Premium/Discount: chỉ mua ở nửa dưới, bán ở nửa trên của dealing range ---
  const dr = dealingRange(m15, swings);
  if (!dr) return null;
  if (bull && spot >= dr.eq) return null;
  if (!bull && spot <= dr.eq) return null;

  // --- Tìm cú quét thanh khoản gần nhất (trong 12 nến đổ lại) ---
  const LOOKBACK = 12;
  const startIdx = Math.max(0, m15.length - LOOKBACK);
  let sweepIdx = -1, sweptLevel = 0;
  for (let i = m15.length - 1; i >= startIdx; i--) {
    // Mốc thanh khoản = swing đã hình thành TRƯỚC nến đang xét (không nhìn trước)
    const prior = swings.filter((s) => s.index < i - 2 && s.kind === (bull ? 'low' : 'high'));
    if (!prior.length) continue;
    const level = bull
      ? Math.min(...prior.slice(-5).map((s) => s.price))
      : Math.max(...prior.slice(-5).map((s) => s.price));
    const swept = bull
      ? m15[i].low < level && m15[i].close > level   // thủng đáy rồi đóng cửa lại phía trên
      : m15[i].high > level && m15[i].close < level; // thủng đỉnh rồi đóng cửa lại phía dưới
    if (swept) { sweepIdx = i; sweptLevel = level; break; }
  }
  if (sweepIdx < 0) return null;

  // --- Chân đẩy sau cú quét: từ điểm cực trị của nến quét tới cực trị ngược lại tới hiện tại ---
  const after = m15.slice(sweepIdx);
  const legStart = bull ? Math.min(...after.map((c) => c.low)) : Math.max(...after.map((c) => c.high));
  const legEnd = bull ? Math.max(...after.map((c) => c.high)) : Math.min(...after.map((c) => c.low));
  const legSize = Math.abs(legEnd - legStart);
  if (legSize < aRef) return null; // chân đẩy quá yếu, chưa đáng tin

  // Entry tại OTE 0.705 (hồi 70.5% chân đẩy) — phải nằm phía chưa tới so với giá hiện tại
  const entry = bull ? legEnd - 0.705 * legSize : legEnd + 0.705 * legSize;
  if (bull ? entry >= spot : entry <= spot) return null; // giá đã hồi qua vùng vào lệnh

  const buffer = aRef * 0.5;
  const sl = enforceMinStop(entry, bull ? legStart - buffer : legStart + buffer, bull, minSlDist);
  const slDist = Math.abs(entry - sl);
  if (slDist <= 0) return null;

  // --- TP: vùng thanh khoản đối diện gần nhất đạt RR hợp lý, nếu không có thì RR 1:2.5 ---
  const minRR = 1.5, maxRR = 5;
  const liq = detectEqualLevels(m15, swings)
    .filter((e) => (bull ? e.price > entry : e.price < entry))
    .map((e) => ({ ...e, dist: Math.abs(e.price - entry) }))
    .sort((a, b) => a.dist - b.dist);
  const ok = liq.find((e) => e.dist / slDist >= minRR && e.dist / slDist <= maxRR);
  const tp = ok ? ok.price : (bull ? entry + slDist * 2.5 : entry - slDist * 2.5);

  return {
    direction: bull ? 'BUY' : 'SELL',
    entry, sl, tp,
    rr: +(Math.abs(tp - entry) / slDist).toFixed(2),
  };
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
