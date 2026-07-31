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

/** Đỉnh/đáy NGÀY HÔM TRƯỚC (PDH/PDL) — mốc thu hút thanh khoản mạnh nhất trong ICT.
 *  Gom nến theo ngày UTC, lấy ngày đã ĐÓNG gần nhất (không lấy ngày đang chạy dở). */
function previousDayLevels(c: Candle[]): { pdh: number; pdl: number } | null {
  const dayOf = (t: number) => Math.floor(t / 86400);
  const today = dayOf(c[c.length - 1].time);
  const prev = c.filter((x) => dayOf(x.time) === today - 1);
  if (prev.length < 4) {
    // Cuối tuần / ngày nghỉ: lùi thêm tối đa 4 ngày để tìm ngày giao dịch gần nhất
    for (let back = 2; back <= 5; back++) {
      const alt = c.filter((x) => dayOf(x.time) === today - back);
      if (alt.length >= 4) {
        return { pdh: Math.max(...alt.map((x) => x.high)), pdl: Math.min(...alt.map((x) => x.low)) };
      }
    }
    return null;
  }
  return { pdh: Math.max(...prev.map((x) => x.high)), pdl: Math.min(...prev.map((x) => x.low)) };
}

/**
 * ICT — dựng theo đúng quy trình 8 bước chuẩn:
 *  1. Xu hướng HTF: Daily + H4 (trước đây dùng H1 — sai khung)
 *  2. Draw on Liquidity: PDH/PDL + Equal High/Low (trước đây thiếu PDH/PDL)
 *  3. Liquidity Sweep vào đúng các mốc đó
 *  4. MSS/CHOCH sau cú quét
 *  5. FVG sinh ra TRONG cú đẩy phá cấu trúc (trước đây lấy FVG bất kỳ từ lúc sweep — sai)
 *  6. Entry tại FVG
 *  7. SL dưới/trên điểm quét (không đặt sát FVG vì dễ bị quét)
 *  8. TP tại vùng thanh khoản kế tiếp theo cấu trúc, không theo số pip cố định
 */
export function decideIctSetup(window: Candle[]): LiveSetup | null {
  if (window.length < 300) return null; // cần đủ nến để dựng H4/Daily
  const m15 = window;
  const n = m15.length;
  const last = m15[n - 1];
  const spot = last.close;
  if (!inKillzone(last.time)) return null;

  const aRef = atrOf(m15) ?? spot * 0.005;
  const minSlDist = Math.max(aRef * 1.5, spot * 0.001);
  const swings = detectSwings(m15);
  if (swings.length < 6) return null;

  // ---- BƯỚC 1: Xu hướng khung lớn Daily + H4 ----
  const h4 = aggregateBy(m15, 16);
  const d1 = aggregateBy(m15, 96);
  if (h4.length < 20 || d1.length < 3) return null;

  const h4Struct = detectStructure(h4, detectSwings(h4));
  const h4Ev = h4Struct[h4Struct.length - 1] ?? null;
  const h4Closes = h4.map((x) => x.close);
  const h4e20 = emaOf(h4Closes, 20), h4e50 = emaOf(h4Closes, 50);
  const h4Bull = h4Ev
    ? h4Ev.direction === 'bull'
    : (h4e20 != null && h4e50 != null ? h4e20 >= h4e50 : null);
  if (h4Bull == null) return null;

  // Daily xác nhận: giá hiện tại so với trung điểm ngày đã đóng gần nhất
  const dPrev = d1[d1.length - 2] ?? d1[d1.length - 1];
  const dMid = (dPrev.high + dPrev.low) / 2;
  const dailyBull = spot >= dMid;
  if (h4Bull !== dailyBull) return null; // Daily và H4 mâu thuẫn → đứng ngoài

  const bull = h4Bull;

  // ---- Premium/Discount (PD Array) ----
  const dr = dealingRange(m15, swings);
  if (!dr) return null;
  if (bull && spot >= dr.eq) return null;
  if (!bull && spot <= dr.eq) return null;

  // ---- BƯỚC 2: Draw on Liquidity — PDH/PDL + Equal High/Low + swing gần đây ----
  const pd = previousDayLevels(m15);
  const eq = detectEqualLevels(m15, swings);
  const pools: number[] = [];
  if (pd) pools.push(bull ? pd.pdl : pd.pdh);
  for (const e of eq) {
    if (bull && e.kind === 'EQL') pools.push(e.price);
    if (!bull && e.kind === 'EQH') pools.push(e.price);
  }
  const recentSwings = swings.filter((s) => s.kind === (bull ? 'low' : 'high')).slice(-6);
  for (const s of recentSwings) pools.push(s.price);
  if (!pools.length) return null;

  // ---- BƯỚC 3: Liquidity Sweep — thủng mốc thanh khoản rồi ĐÓNG CỬA trở lại ----
  const SWEEP_LOOKBACK = 24;
  let sweepIdx = -1, sweepExtreme = 0;
  for (let i = n - 1; i >= Math.max(0, n - SWEEP_LOOKBACK); i--) {
    // Chỉ xét các mốc đã tồn tại TRƯỚC nến này (không nhìn trước)
    const valid = pools.filter((lv) => (bull ? m15[i].low < lv && m15[i].close > lv
                                             : m15[i].high > lv && m15[i].close < lv));
    if (valid.length) { sweepIdx = i; sweepExtreme = bull ? m15[i].low : m15[i].high; break; }
  }
  if (sweepIdx < 0 || sweepIdx >= n - 2) return null;

  // ---- BƯỚC 4: MSS — cú đẩy phải phá swing ngược chiều gần nhất trước cú quét ----
  const opposing = swings.filter((s) => s.index < sweepIdx && s.kind === (bull ? 'high' : 'low'));
  if (!opposing.length) return null;
  const mssLevel = opposing[opposing.length - 1].price;
  let mssIdx = -1;
  for (let i = sweepIdx + 1; i < n; i++) {
    if (bull ? m15[i].high > mssLevel : m15[i].low < mssLevel) { mssIdx = i; break; }
  }
  if (mssIdx < 0) return null; // chưa phá cấu trúc → cú quét chỉ là nhiễu

  // Displacement: cú đẩy tạo MSS phải đủ mạnh, không phải nhích qua vài giá
  const legEnd = bull
    ? Math.max(...m15.slice(sweepIdx, mssIdx + 1).map((x) => x.high))
    : Math.min(...m15.slice(sweepIdx, mssIdx + 1).map((x) => x.low));
  if (Math.abs(legEnd - sweepExtreme) < aRef * 1.5) return null;

  // ---- BƯỚC 5: FVG sinh ra TRONG cú đẩy phá cấu trúc (từ sweep tới ngay sau MSS) ----
  const fvg = findFreshFvg(m15, sweepIdx, Math.min(mssIdx + 2, n - 1), bull);
  if (!fvg) return null;

  // ---- BƯỚC 6: Entry tại FVG (CE — điểm giữa khoảng mất cân bằng) ----
  const entry = (fvg.top + fvg.bottom) / 2;
  if (bull ? entry >= spot : entry <= spot) return null; // giá đã lấp FVG rồi

  // ---- BƯỚC 7: SL dưới đáy / trên đỉnh cú quét, KHÔNG đặt sát FVG ----
  const buffer = aRef * 0.5;
  const sl = enforceMinStop(entry, bull ? sweepExtreme - buffer : sweepExtreme + buffer, bull, minSlDist);
  const slDist = Math.abs(entry - sl);
  if (slDist <= 0) return null;

  // ---- BƯỚC 8: TP tại vùng thanh khoản KẾ TIẾP (PDH/PDL, Equal High/Low, đỉnh/đáy cũ) ----
  const targets: number[] = [];
  if (pd) targets.push(bull ? pd.pdh : pd.pdl);
  for (const e of eq) {
    if (bull && e.kind === 'EQH') targets.push(e.price);
    if (!bull && e.kind === 'EQL') targets.push(e.price);
  }
  for (const s of swings.filter((x) => x.kind === (bull ? 'high' : 'low')).slice(-8)) targets.push(s.price);

  const minRR = 1.5, maxRR = 8;
  const valid = targets
    .filter((t) => (bull ? t > entry : t < entry))
    .map((t) => ({ price: t, rr: Math.abs(t - entry) / slDist }))
    .filter((t) => t.rr >= minRR && t.rr <= maxRR)
    .sort((a, b) => a.rr - b.rr);
  if (!valid.length) return null; // không có mục tiêu cấu trúc hợp lý → không vào lệnh
  const tp = valid[0].price;

  return {
    direction: bull ? 'BUY' : 'SELL',
    entry, sl, tp,
    rr: +(Math.abs(tp - entry) / slDist).toFixed(2),
  };
}

/**
 * SMC / SK System — trả về setup (entry/SL/TP/RR) hoặc null nếu "đứng ngoài".
 * @param window nến M15 đã đóng, tính đến thời điểm ra quyết định (nến cuối = hiện tại)
 */
export function decideLiveSetup(window: Candle[], method: 'SMC' | 'SK'): LiveSetup | null {
  if (window.length < 300) return null;
  const m15 = window;
  const spot = m15[m15.length - 1].close;
  const aRef = atrOf(m15) ?? spot * 0.005;
  const minSlDist = Math.max(aRef * 1.5, spot * 0.001);
  const m15Swings = detectSwings(m15);

  if (method === 'SK') return decideSkGoldenPocket(m15, aRef, minSlDist, spot, m15Swings);
  return decideSmcAPlus(m15, aRef, minSlDist, spot, m15Swings);
}

/**
 * SK System — "setup mạnh nhất" theo đúng quy trình:
 *   Xu hướng H4+H1 → Impulse (0→A) → Retracement (A→B) → GOLDEN POCKET 0.705-0.786
 *   → XÁC NHẬN (nến từ chối hoặc phá cấu trúc ngắn hạn) → Entry → SL dưới điểm 0
 *   → TP1 tại đỉnh A, TP2 tại Fib Extension 1.272 / 1.414 / 1.618
 *
 * Ba khác biệt lớn so với bản SK cũ:
 *  1. Vùng vào lệnh là GOLDEN POCKET 0.705-0.786, không phải mốc 0.618 đơn lẻ.
 *  2. BẮT BUỘC CÓ XÁC NHẬN — bản cũ đặt lệnh chờ ngay khi giá chạm mốc Fib, tức mua chỉ vì "giá tới
 *     vùng". Golden Pocket chỉ là VỊ TRÍ, không phải tín hiệu. Bản này chờ nến từ chối mạnh hoặc
 *     phá cấu trúc ngắn hạn theo hướng xu hướng rồi mới vào.
 *  3. SL đặt DƯỚI ĐIỂM 0 (gốc sóng), không đặt ngay sau 0.786 — tức không nằm trong/sát vùng
 *     Golden Pocket, nơi giá hay quét thêm một nhịp trước khi đi thật.
 */
function decideSkGoldenPocket(
  m15: Candle[], aRef: number, minSlDist: number, spot: number, swings: Swing[],
): LiveSetup | null {
  const n = m15.length;

  // ---- BƯỚC 1: Xu hướng H4 VÀ H1 phải cùng chiều ----
  const trendOf = (c: Candle[]): boolean | null => {
    if (c.length < 25) return null;
    const ev = detectStructure(c, detectSwings(c)).slice(-1)[0] ?? null;
    if (ev) return ev.direction === 'bull';
    const cl = c.map((x) => x.close);
    const a = emaOf(cl, 20), b = emaOf(cl, 50);
    return a != null && b != null ? a >= b : null;
  };
  const h4Bull = trendOf(aggregateBy(m15, 16));
  const h1Bull = trendOf(aggregateBy(m15, 4));
  if (h4Bull == null || h1Bull == null || h4Bull !== h1Bull) return null;
  const bull = h4Bull;

  // ---- BƯỚC 2: Impulse 0→A phải là cú đẩy MẠNH (Expansion Leg) ----
  const kind0: 'high' | 'low' = bull ? 'low' : 'high';
  const p0 = [...swings].reverse().find((s) => s.kind === kind0 && s.index < n - 6);
  if (!p0) return null;
  const after0 = swings.filter((s) => s.index > p0.index && s.kind !== kind0);
  if (!after0.length) return null;
  const pA = bull
    ? after0.reduce((m, s) => (s.price > m.price ? s : m))
    : after0.reduce((m, s) => (s.price < m.price ? s : m));
  const range = Math.abs(pA.price - p0.price);
  if (range < aRef * 2) return null;                       // cú đẩy quá yếu, không phải impulse
  if (bull ? pA.price <= p0.price : pA.price >= p0.price) return null;

  // ---- BƯỚC 3: Golden Pocket 0.705 - 0.786 của sóng 0→A ----
  const fib = (r: number) => (bull ? pA.price - r * range : pA.price + r * range);
  const gpNear = fib(0.705);   // rìa gần đỉnh A
  const gpFar = fib(0.786);    // rìa gần điểm 0
  const gpTop = bull ? gpNear : gpFar;
  const gpBottom = bull ? gpFar : gpNear;

  // ---- BƯỚC 4: Giá phải đã hồi VÀO Golden Pocket, và chưa phá điểm 0 ----
  const afterA = m15.slice(pA.index + 1);
  if (afterA.length < 2) return null;
  const touched = afterA.some((c) => (bull ? c.low <= gpTop && c.low >= gpBottom - aRef * 0.3
                                           : c.high >= gpBottom && c.high <= gpTop + aRef * 0.3));
  if (!touched) return null;
  const brokeOrigin = bull
    ? Math.min(...afterA.map((c) => c.low)) < p0.price
    : Math.max(...afterA.map((c) => c.high)) > p0.price;
  if (brokeOrigin) return null;                            // sóng đã bị vô hiệu

  // ---- BƯỚC 5: XÁC NHẬN — nến từ chối mạnh HOẶC phá cấu trúc ngắn hạn ----
  const CONFIRM_WINDOW = 6;
  const recent = m15.slice(Math.max(pA.index + 1, n - CONFIRM_WINDOW));
  // (a) Nến từ chối: râu đâm vào Golden Pocket nhưng đóng cửa bật ra ngoài, thân nghiêng đúng hướng
  const rejection = recent.some((c) => {
    const span = c.high - c.low;
    if (span <= 0) return false;
    const pos = (c.close - c.low) / span;                  // vị trí giá đóng trong biên độ nến
    return bull
      ? c.low <= gpTop && c.close > gpTop && pos >= 0.5
      : c.high >= gpBottom && c.close < gpBottom && pos <= 0.5;
  });
  // (b) Phá cấu trúc ngắn hạn: vượt swing ngược chiều gần nhất hình thành SAU đỉnh A
  const microSwings = swings.filter((s) => s.index > pA.index && s.kind !== kind0);
  const microLevel = microSwings.length ? microSwings[microSwings.length - 1].price : null;
  const bos = microLevel != null && recent.some((c) => (bull ? c.high > microLevel : c.low < microLevel));
  if (!rejection && !bos) return null;                     // Golden Pocket chỉ là VỊ TRÍ, chưa đủ để vào

  // ---- BƯỚC 6: Entry ngay sau xác nhận (không phải lệnh chờ mù quáng tại mốc Fib) ----
  const entry = spot;

  // ---- BƯỚC 7: SL dưới/trên ĐIỂM 0, không nằm trong Golden Pocket ----
  const buffer = aRef * 0.5;
  const sl = enforceMinStop(entry, bull ? p0.price - buffer : p0.price + buffer, bull, minSlDist);
  const slDist = Math.abs(entry - sl);
  if (slDist <= 0) return null;

  // ---- BƯỚC 8: TP1 = đỉnh A, TP2 = Fib Extension 1.272 / 1.414 / 1.618 ----
  const ladder = [
    pA.price,                                                  // TP1
    bull ? p0.price + 1.272 * range : p0.price - 1.272 * range,
    bull ? p0.price + 1.414 * range : p0.price - 1.414 * range,
    bull ? p0.price + 1.618 * range : p0.price - 1.618 * range,
  ];
  const MIN_RR = 2;                                            // yêu cầu chất lượng của SK System
  const pick = ladder
    .filter((t) => (bull ? t > entry : t < entry))
    .map((t) => ({ price: t, rr: Math.abs(t - entry) / slDist }))
    .filter((t) => t.rr >= MIN_RR && t.rr <= 8)
    .sort((a, b) => a.rr - b.rr)[0];
  if (!pick) return null;                                      // không đạt RR tối thiểu 1:2 → bỏ qua

  return {
    direction: bull ? 'BUY' : 'SELL',
    entry, sl, tp: pick.price,
    rr: +pick.rr.toFixed(2),
  };
}

/**
 * Setup A+ theo checklist chuẩn:
 *   H4 (HH+HL / LL+LH) → Liquidity → Sweep → CHOCH → Order Block → FVG → Pullback
 *   → Entry tại vùng OB và FVG CHỒNG NHAU → SL dưới đáy Sweep → TP tại thanh khoản đối diện
 *
 * Khác biệt lớn so với bản SMC cũ (bản cũ chỉ "tìm Order Block gần giá rồi chờ chạm"):
 *  - Bắt buộc có LIQUIDITY SWEEP trước. Không quét thanh khoản thì không vào lệnh.
 *  - Bắt buộc có CHOCH (phá đỉnh/đáy gần nhất) xác nhận đổi quyền kiểm soát.
 *  - Order Block phải là NẾN NGƯỢC CHIỀU CUỐI CÙNG ngay trước cú đẩy phá cấu trúc, không phải OB bất kỳ.
 *  - Entry chỉ đặt khi OB và FVG CHỒNG LÊN NHAU (hợp lưu) — đây là điều kiện "A+".
 *  - SL đặt dưới ĐÁY CÚ QUÉT, không phải sát rìa OB (checklist cảnh báo sát OB rất dễ bị quét).
 */
function decideSmcAPlus(
  m15: Candle[], aRef: number, minSlDist: number, spot: number, swings: Swing[],
): LiveSetup | null {
  const n = m15.length;
  if (n < 300) return null;

  // ---- BƯỚC 1: Xu hướng H4 theo cấu trúc HH+HL (tăng) hoặc LL+LH (giảm) ----
  const h4 = aggregateBy(m15, 16);
  if (h4.length < 20) return null;
  const h4Sw = detectSwings(h4);
  const highs = h4Sw.filter((s) => s.kind === 'high').slice(-2);
  const lows = h4Sw.filter((s) => s.kind === 'low').slice(-2);
  if (highs.length < 2 || lows.length < 2) return null;
  const hh = highs[1].price > highs[0].price, hl = lows[1].price > lows[0].price;
  const ll = lows[1].price < lows[0].price, lh = highs[1].price < highs[0].price;
  const bull = hh && hl ? true : (ll && lh ? false : null);
  if (bull == null) return null; // cấu trúc H4 không rõ ràng → đứng ngoài

  // ---- BƯỚC 2: Liquidity — Equal Low/High + PDL/PDH + Swing Low/High ----
  const pd = previousDayLevels(m15);
  const eq = detectEqualLevels(m15, swings);
  const pools: number[] = [];
  if (pd) pools.push(bull ? pd.pdl : pd.pdh);
  for (const e of eq) {
    if (bull && e.kind === 'EQL') pools.push(e.price);
    if (!bull && e.kind === 'EQH') pools.push(e.price);
  }
  for (const s of swings.filter((x) => x.kind === (bull ? 'low' : 'high')).slice(-6)) pools.push(s.price);
  if (!pools.length) return null;

  // ---- BƯỚC 3: Liquidity Sweep — đâm thủng mốc rồi ĐÓNG CỬA trở lại ----
  let sweepIdx = -1, sweepExtreme = 0;
  for (let i = n - 1; i >= Math.max(0, n - 24); i--) {
    const hit = pools.some((lv) => (bull ? m15[i].low < lv && m15[i].close > lv
                                         : m15[i].high > lv && m15[i].close < lv));
    if (hit) { sweepIdx = i; sweepExtreme = bull ? m15[i].low : m15[i].high; break; }
  }
  if (sweepIdx < 0 || sweepIdx >= n - 2) return null;

  // ---- BƯỚC 4: CHOCH — phá đỉnh (Buy) / đáy (Sell) gần nhất trước cú quét ----
  const opposing = swings.filter((s) => s.index < sweepIdx && s.kind === (bull ? 'high' : 'low'));
  if (!opposing.length) return null;
  const chochLevel = opposing[opposing.length - 1].price;
  let breakIdx = -1;
  for (let i = sweepIdx + 1; i < n; i++) {
    if (bull ? m15[i].high > chochLevel : m15[i].low < chochLevel) { breakIdx = i; break; }
  }
  if (breakIdx < 0) return null; // chưa phá cấu trúc → KHÔNG vào lệnh

  // ---- BƯỚC 5: Order Block = nến ngược chiều CUỐI CÙNG ngay trước cú đẩy phá cấu trúc ----
  let obIdx = -1;
  for (let j = breakIdx - 1; j >= sweepIdx; j--) {
    const bearish = m15[j].close < m15[j].open;
    if (bull ? bearish : !bearish) { obIdx = j; break; }
  }
  if (obIdx < 0) return null;
  const obTop = Math.max(m15[obIdx].open, m15[obIdx].close);
  const obBottom = Math.min(m15[obIdx].open, m15[obIdx].close);

  // ---- BƯỚC 6: FVG sinh ra trong cú đẩy ----
  const fvg = findFreshFvg(m15, sweepIdx, Math.min(breakIdx + 2, n - 1), bull);
  if (!fvg) return null;

  // ---- BƯỚC 7-8: Hợp lưu Order Block + FVG ----
  // Lưu ý hình học: trong một cú đẩy sạch, FVG luôn nằm NGAY TRÊN thân nến Order Block (với lệnh
  // Buy) chứ không đè lên nó — nên nếu bắt buộc hai vùng phải CHỒNG nhau thì điều kiện gần như
  // không bao giờ thoả. "Hợp lưu" ở đây hiểu đúng là hai vùng LIỀN KỀ nhau, tạo thành một vùng cầu
  // (hoặc cung) liên tục mà giá phải đi xuyên qua khi hồi về.
  const gapBetween = bull ? fvg.bottom - obTop : obBottom - fvg.top;
  if (gapBetween > aRef * 0.5) return null; // hai vùng cách xa nhau → không phải hợp lưu A+

  // Chờ pullback về Order Block (vùng chiết khấu sâu nhất trong cụm hợp lưu)
  const entry = bull ? obTop : obBottom;
  if (bull ? entry >= spot : entry <= spot) return null; // giá đã hồi qua vùng rồi

  // ---- BƯỚC 9: SL dưới ĐÁY CÚ QUÉT (không đặt sát Order Block) ----
  const buffer = aRef * 0.5;
  const sl = enforceMinStop(entry, bull ? sweepExtreme - buffer : sweepExtreme + buffer, bull, minSlDist);
  const slDist = Math.abs(entry - sl);
  if (slDist <= 0) return null;

  // ---- BƯỚC 10: TP tại Buy-side / Sell-side Liquidity ----
  const targets: number[] = [];
  if (pd) targets.push(bull ? pd.pdh : pd.pdl);
  for (const e of eq) {
    if (bull && e.kind === 'EQH') targets.push(e.price);
    if (!bull && e.kind === 'EQL') targets.push(e.price);
  }
  for (const s of swings.filter((x) => x.kind === (bull ? 'high' : 'low')).slice(-8)) targets.push(s.price);

  const valid = targets
    .filter((t) => (bull ? t > entry : t < entry))
    .map((t) => ({ price: t, rr: Math.abs(t - entry) / slDist }))
    .filter((t) => t.rr >= 1.5 && t.rr <= 8)
    .sort((a, b) => a.rr - b.rr);
  if (!valid.length) return null;

  return {
    direction: bull ? 'BUY' : 'SELL',
    entry, sl, tp: valid[0].price,
    rr: +(Math.abs(valid[0].price - entry) / slDist).toFixed(2),
  };
}
