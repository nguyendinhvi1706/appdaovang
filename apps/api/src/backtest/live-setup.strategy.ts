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
 * ================== ICT (Inner Circle Trader) — mô hình đầy đủ ==================
 * Bản trước quá sơ sài: chỉ bắt "quét thanh khoản rồi vào lệnh tại OTE", bỏ mất khâu quan trọng
 * nhất nên mọi cú quét do nhiễu cũng bị tính là tín hiệu. Bản này dựng đúng chuỗi kinh điển:
 *
 *   Bias khung lớn → Quét thanh khoản (sweep) → DISPLACEMENT phá cấu trúc (MSS)
 *   → FVG do chính cú đẩy đó tạo ra → vào lệnh tại CE (giữa FVG) → SL ngoài điểm quét
 *   → TP tại thanh khoản đối diện
 *
 * Ba khâu bản cũ THIẾU và là lý do setup ra rác:
 *  1. DISPLACEMENT — cú đẩy sau sweep phải đủ mạnh (≥1.5×ATR) chứ không phải nhích nhẹ.
 *  2. MSS (Market Structure Shift) — cú đẩy đó phải PHÁ được swing ngược chiều gần nhất. Không phá
 *     được nghĩa là cấu trúc chưa đổi, cú quét chỉ là nhiễu.
 *  3. Entry tại FVG của cú đẩy — đây mới là điểm vào chuẩn ICT. Không có FVG thì không có dấu vết
 *     mất cân bằng, tức không có cơ sở để chờ giá quay lại.
 *
 * Kèm các bộ lọc: Killzone (London 07-10, New York 12-15 UTC) và Premium/Discount (chỉ BUY nửa
 * dưới, SELL nửa trên của dealing range).
 */
function inKillzone(timeSec: number): boolean {
  const h = new Date(timeSec * 1000).getUTCHours();
  return (h >= 7 && h < 10) || (h >= 12 && h < 15);
}

/** FVG (khoảng mất cân bằng 3 nến) tạo ra trong đoạn [from..to], CHƯA bị giá lấp tính tới nến cuối */
function findFreshFvg(
  c: Candle[], from: number, to: number, bull: boolean,
): { top: number; bottom: number } | null {
  const out: { top: number; bottom: number; at: number }[] = [];
  for (let j = Math.max(2, from); j <= to && j < c.length; j++) {
    if (bull && c[j].low > c[j - 2].high) out.push({ top: c[j].low, bottom: c[j - 2].high, at: j });
    if (!bull && c[j].high < c[j - 2].low) out.push({ top: c[j - 2].low, bottom: c[j].high, at: j });
  }
  // Loại FVG đã bị giá lấp — phải kiểm tra từ nến NGAY SAU khi FVG hình thành (z.at) cho tới hiện
  // tại. Trước đây kiểm tra từ `to + 1` mà `to` lại là nến cuối, nên vòng lặp không bao giờ chạy và
  // mọi FVG đều bị coi là còn nguyên — kể cả những khoảng đã bị lấp từ lâu, mất hết ý nghĩa.
  const alive = out.filter((z) => {
    for (let k = z.at + 1; k < c.length; k++) {
      if (bull ? c[k].low <= z.bottom : c[k].high >= z.top) return false;
    }
    return true;
  });
  if (!alive.length) return null;
  // Lấy FVG gần cú quét nhất (chiết khấu sâu nhất cho BUY / cao nhất cho SELL)
  return alive.sort((a, b) => (bull ? a.bottom - b.bottom : b.top - a.top))[0];
}

export function decideIctSetup(window: Candle[]): LiveSetup | null {
  if (window.length < 80) return null;
  const m15 = window;
  const n = m15.length;
  const last = m15[n - 1];
  const spot = last.close;
  if (!inKillzone(last.time)) return null;

  const aRef = atrOf(m15) ?? spot * 0.005;
  const minSlDist = Math.max(aRef * 1.5, spot * 0.001);
  const swings = detectSwings(m15);
  if (swings.length < 6) return null;

  // --- Bias khung lớn (H1) ---
  const h1 = aggregateBy(m15, 4);
  const h1Struct = detectStructure(h1, detectSwings(h1));
  const lastEv = h1Struct[h1Struct.length - 1] ?? null;
  const closes = h1.map((x) => x.close);
  const e20 = emaOf(closes, 20), e50 = emaOf(closes, 50);
  const trend = lastEv
    ? (lastEv.direction === 'bull' ? 'TĂNG' : 'GIẢM')
    : (e20 != null && e50 != null ? (e20 >= e50 ? 'TĂNG' : 'GIẢM') : null);
  if (!trend) return null;
  const bull = trend === 'TĂNG';

  // --- Premium/Discount ---
  const dr = dealingRange(m15, swings);
  if (!dr) return null;
  if (bull && spot >= dr.eq) return null;
  if (!bull && spot <= dr.eq) return null;

  // --- 1) Quét thanh khoản: thủng swing cũ rồi ĐÓNG CỬA trở lại bên trong ---
  const SWEEP_LOOKBACK = 24;
  let sweepIdx = -1, sweepExtreme = 0;
  for (let i = n - 1; i >= Math.max(0, n - SWEEP_LOOKBACK); i--) {
    const prior = swings.filter((s) => s.index <= i - 3 && s.kind === (bull ? 'low' : 'high'));
    if (prior.length < 2) continue;
    const level = bull
      ? Math.min(...prior.slice(-6).map((s) => s.price))
      : Math.max(...prior.slice(-6).map((s) => s.price));
    const swept = bull
      ? m15[i].low < level && m15[i].close > level
      : m15[i].high > level && m15[i].close < level;
    if (swept) { sweepIdx = i; sweepExtreme = bull ? m15[i].low : m15[i].high; break; }
  }
  if (sweepIdx < 0 || sweepIdx >= n - 2) return null; // cần ít nhất vài nến sau sweep để có cú đẩy

  // --- 2) Displacement: cú đẩy sau sweep phải đủ mạnh ---
  const after = m15.slice(sweepIdx);
  const legEnd = bull ? Math.max(...after.map((c) => c.high)) : Math.min(...after.map((c) => c.low));
  const displacement = Math.abs(legEnd - sweepExtreme);
  if (displacement < aRef * 1.5) return null; // nhích nhẹ, không phải displacement

  // --- 3) MSS: cú đẩy phải PHÁ swing ngược chiều gần nhất trước cú quét ---
  const opposing = swings.filter((s) => s.index < sweepIdx && s.kind === (bull ? 'high' : 'low'));
  if (!opposing.length) return null;
  const mssLevel = opposing[opposing.length - 1].price;
  const brokeStructure = bull ? legEnd > mssLevel : legEnd < mssLevel;
  if (!brokeStructure) return null; // cấu trúc chưa đổi → cú quét chỉ là nhiễu

  // --- 4) Entry tại CE (giữa) của FVG do cú đẩy tạo ra ---
  const fvg = findFreshFvg(m15, sweepIdx, n - 1, bull);
  if (!fvg) return null;
  const entry = (fvg.top + fvg.bottom) / 2;
  if (bull ? entry >= spot : entry <= spot) return null; // giá đã đi qua vùng vào lệnh

  const buffer = aRef * 0.5;
  const sl = enforceMinStop(entry, bull ? sweepExtreme - buffer : sweepExtreme + buffer, bull, minSlDist);
  const slDist = Math.abs(entry - sl);
  if (slDist <= 0) return null;

  // --- 5) TP: thanh khoản đối diện gần nhất đạt RR hợp lý ---
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
  // Lọc Premium/Discount — quy tắc gốc của SMC/ICT mà nhánh này TRƯỚC ĐÂY BỎ QUÊN hoàn toàn: chỉ
  // mua ở nửa dưới (discount) và bán ở nửa trên (premium) của dealing range. Không có bộ lọc này,
  // thuật toán sẵn sàng mua ngay đỉnh miễn là có Order Block gần đó — sai hẳn tinh thần phương pháp.
  const drSmc = dealingRange(m15, m15Swings);
  const inRightHalf = (z: Zone) => {
    if (!drSmc) return true;
    const zonePrice = bull ? z.top : z.bottom;
    return bull ? zonePrice < drSmc.eq : zonePrice > drSmc.eq;
  };

  const obCand = obs.filter(dirMatch).filter(inRightHalf).filter((z) => zoneDist(z) <= aRef * 3).sort((a, b) => zoneDist(a) - zoneDist(b));
  const fvgCand = fvgs.filter(dirMatch).filter(inRightHalf).filter((z) => zoneDist(z) <= aRef * 3).sort((a, b) => zoneDist(a) - zoneDist(b));
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
