import { Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MarketService } from '../market/market.service';
import { atr, Candle, ema, rsi, swingLevels } from './indicators';
import { detectEqualLevels, detectFVG, detectOrderBlocks, detectStructure, detectSwings, Zone } from '../smc/smc.engine';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

const SYSTEM_PROMPT = `Bạn là AI Trader — trợ lý phân tích thị trường của AppDaoVang, nói tiếng Việt.
Nhiệm vụ: phân tích kỹ thuật, nhận định xu hướng, gợi ý vùng SL/TP, tính khối lượng theo rủi ro.
Nguyên tắc:
- CHỈ phân tích và tư vấn, KHÔNG bao giờ tự đặt lệnh.
- BẮT BUỘC dùng đúng số liệu trong phần "DỮ LIỆU THỊ TRƯỜNG" kèm theo câu hỏi. TUYỆT ĐỐI KHÔNG dùng mức giá bạn nhớ từ trước — kiến thức của bạn đã lỗi thời. Nếu bạn nêu mức giá khác xa "Giá hiện tại" trong dữ liệu là SAI.
- Mọi vùng hỗ trợ/kháng cự/SL/TP phải nằm gần Giá hiện tại (trong khoảng ±5%).
- Khi tính lot size: Lot = (Số dư × Risk%) / (SL pips × giá trị pip mỗi lot). Với XAUUSD 1 pip (0.1$) = 10$/lot; cặp FX chuẩn 1 pip = 10$/lot. Ví dụ: số dư 1000$, risk 2% = 20$, SL 30 pips → Lot = 20 / (30 × 10) = 0.06 lot.
- Luôn nhắc quản lý rủi ro, không khuyến khích giao dịch quá mức.
- Trả lời ngắn gọn, có cấu trúc, dùng số liệu cụ thể.
- Cuối phân tích luôn ghi: "⚠️ Đây là phân tích tham khảo, không phải lời khuyên đầu tư."`;

@Injectable()
export class AiService {
  constructor(private prisma: PrismaService, private market: MarketService) {}

  private detectSymbol(text: string): string {
    const m = text.toUpperCase().match(/\b(XAUUSD|XAGUSD|[A-Z]{3}(USD|JPY|EUR|GBP|CHF|AUD|CAD|NZD))\b/);
    if (m) return m[0];
    if (/vàng|gold/i.test(text)) return 'XAUUSD';
    return 'XAUUSD';
  }

  private async buildMarketContext(symbol: string, intraday: '15m' | '1h' = '1h'): Promise<{ text: string; price: number | null }> {
    const tag = intraday === '15m' ? 'M15' : 'H1';
    const [h1, d1, spot] = await Promise.all([
      this.market.candles(symbol, intraday).catch(() => [] as Candle[]),
      this.market.candles(symbol, '1d').catch(() => [] as Candle[]),
      this.market.quote(symbol).catch(() => null),
    ]);
    // Giá spot realtime (Swissquote, khớp TradingView) là nguồn chuẩn cho "giá hiện tại"
    const spotPrice = spot?.price ?? null;
    if (spotPrice == null && !h1.length && !d1.length) {
      throw new ServiceUnavailableException(
        `Không lấy được dữ liệu thị trường cho ${symbol} — không thể phân tích chính xác. Thử lại sau ít phút.`,
      );
    }
    const candleClose = h1.length ? h1[h1.length - 1].close : d1.length ? d1[d1.length - 1].close : null;
    const price = spotPrice ?? candleClose;
    // Nếu nến Yahoo lệch >1% so với spot thì cảnh báo model bỏ qua phần nến
    const candlesReliable =
      spotPrice == null || candleClose == null || Math.abs(candleClose - spotPrice) / spotPrice < 0.01;

    const lines: string[] = [`DỮ LIỆU THỊ TRƯỜNG ${symbol} (${new Date().toISOString()}):`];
    if (spotPrice != null) {
      lines.push(`GIÁ SPOT HIỆN TẠI (realtime, nguồn chuẩn): ${spotPrice}`);
    }
    if (!candlesReliable) {
      lines.push(`LƯU Ý: dữ liệu nến bên dưới bị trễ/lệch so với giá spot — chỉ dùng để tham khảo xu hướng, KHÔNG dùng làm mức giá.`);
    }
    if (h1.length) {
      const closes = h1.map((c) => c.close);
      const { supports, resistances } = swingLevels(h1);
      lines.push(
        `[Khung ${tag}] EMA20: ${ema(closes, 20)} | EMA50: ${ema(closes, 50)} | RSI14: ${rsi(closes)} | ATR14: ${atr(h1)}`,
        `[${tag}] Kháng cự gần: ${resistances.slice(0, 3).map((x) => x.toFixed(4)).join(', ') || 'n/a'}`,
        `[${tag}] Hỗ trợ gần: ${supports.slice(0, 3).map((x) => x.toFixed(4)).join(', ') || 'n/a'}`,
        `[${tag}] 10 nến gần nhất (O/H/L/C): ${h1.slice(-10).map((c) => `${c.open.toFixed(2)}/${c.high.toFixed(2)}/${c.low.toFixed(2)}/${c.close.toFixed(2)}`).join(' | ')}`,
      );
    }
    if (d1.length) {
      const closes = d1.map((c) => c.close);
      lines.push(
        `[Khung D1] EMA20: ${ema(closes, 20)} | EMA50: ${ema(closes, 50)} | EMA200: ${ema(closes, 200)} | RSI14: ${rsi(closes)}`,
        `[D1] Cao nhất 6 tháng: ${Math.max(...d1.map((c) => c.high)).toFixed(4)} | Thấp nhất 6 tháng: ${Math.min(...d1.map((c) => c.low)).toFixed(4)}`,
      );
    }
    return { text: lines.join('\n'), price };
  }

  private async buildUserContext(userId: string): Promise<string> {
    const [accounts, entries] = await Promise.all([
      this.prisma.mt5Account.findMany({ where: { userId } }),
      this.prisma.journalEntry.findMany({ where: { userId }, orderBy: { openedAt: 'desc' }, take: 20 }),
    ]);
    const lines: string[] = ['THÔNG TIN NGƯỜI DÙNG:'];
    const def = accounts.find((a) => a.isDefault) ?? accounts[0];
    lines.push(def ? `Số dư tài khoản: ${def.balance} ${def.currency}` : 'Chưa khai báo tài khoản MT5.');
    if (entries.length) {
      const closed = entries.filter((e) => e.result !== 'OPEN');
      const wins = closed.filter((e) => e.result === 'WIN').length;
      lines.push(`20 lệnh gần nhất: ${wins}W/${closed.length - wins}L trong ${closed.length} lệnh đã đóng.`);
      const mistakes = entries.map((e) => e.mistakes).filter(Boolean).slice(0, 5);
      if (mistakes.length) lines.push(`Lỗi hay mắc: ${mistakes.join('; ')}`);
    }
    return lines.join('\n');
  }

  async chat(userId: string, messages: ChatMessage[]): Promise<{ reply: string; symbol: string }> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const symbol = this.detectSymbol(lastUser);

    const [market, user] = await Promise.all([
      this.buildMarketContext(symbol),
      this.buildUserContext(userId),
    ]);

    const baseUrl = (process.env.AI_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/$/, '');
    const model = process.env.AI_MODEL ?? 'llama3.2';
    const apiKey = process.env.AI_API_KEY ?? 'ollama';

    // Nhét dữ liệu thật vào NGAY TRONG câu hỏi cuối — model nhỏ chú ý message cuối
    // hơn nhiều so với system prompt, tránh việc bịa giá cũ từ training data.
    const history = messages.slice(-10, -1);
    const finalUser = {
      role: 'user' as const,
      content: `${market.text}\n\n${user}\n\n---\nGiá ${symbol} HIỆN TẠI là ${market.price?.toFixed(2)}. Phân tích phải bám sát mức giá này.\n\nCâu hỏi: ${lastUser}`,
    };

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...history,
          finalUser,
        ],
      }),
    }).catch(() => null);

    if (!res || !res.ok) {
      const detail = res ? `${res.status} ${await res.text().catch(() => '')}` : 'không kết nối được';
      throw new ServiceUnavailableException(
        `Không gọi được AI (${detail.slice(0, 200)}). Kiểm tra AI_BASE_URL/AI_API_KEY trong apps/api/.env — nếu dùng Ollama hãy chắc chắn "ollama serve" đang chạy và đã pull model.`,
      );
    }
    const json: any = await res.json();
    return { reply: json?.choices?.[0]?.message?.content ?? '(AI không trả lời)', symbol };
  }

  // ================= GĐ5: AI phân tích nhật ký =================

  private async callLlm(messages: { role: string; content: string }[], temperature = 0.3): Promise<string | null> {
    const baseUrl = (process.env.AI_BASE_URL ?? 'http://localhost:11434/v1').replace(/\/$/, '');
    const model = process.env.AI_MODEL ?? 'llama3.2';
    const apiKey = process.env.AI_API_KEY ?? 'ollama';
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature, messages }),
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const json: any = await res.json();
    return json?.choices?.[0]?.message?.content ?? null;
  }

  async journalInsights(userId: string) {
    const entries = await this.prisma.journalEntry.findMany({
      where: { userId, result: { not: 'OPEN' } },
      orderBy: { openedAt: 'desc' },
      take: 200,
    });
    if (entries.length < 5) {
      return {
        enough: false,
        message: `Cần ít nhất 5 lệnh đã đóng để phân tích (hiện có ${entries.length}). Hãy ghi thêm nhật ký!`,
        stats: null, findings: [], aiSummary: null,
      };
    }

    type Agg = { trades: number; wins: number; pnl: number };
    const bump = (m: Map<string, Agg>, key: string, e: (typeof entries)[number]) => {
      const a = m.get(key) ?? { trades: 0, wins: 0, pnl: 0 };
      a.trades++; if (e.result === 'WIN') a.wins++; a.pnl += e.pnl ?? 0;
      m.set(key, a);
    };
    const sessionOf = (d: Date) => {
      const h = d.getUTCHours();
      if (h < 7) return 'Phiên Á';
      if (h < 13) return 'Phiên London';
      if (h < 21) return 'Phiên New York';
      return 'Ngoài phiên';
    };
    const weekdays = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];

    const bySession = new Map<string, Agg>();
    const bySymbol = new Map<string, Agg>();
    const byDirection = new Map<string, Agg>();
    const byEmotion = new Map<string, Agg>();
    const byWeekday = new Map<string, Agg>();
    for (const e of entries) {
      const d = new Date(e.openedAt);
      bump(bySession, sessionOf(d), e);
      bump(bySymbol, e.symbol, e);
      bump(byDirection, e.direction, e);
      if (e.emotion?.trim()) bump(byEmotion, e.emotion.trim().toLowerCase(), e);
      bump(byWeekday, weekdays[d.getUTCDay()], e);
    }
    const toRows = (m: Map<string, Agg>) =>
      [...m.entries()]
        .map(([key, a]) => ({ key, trades: a.trades, winRate: +((a.wins / a.trades) * 100).toFixed(0), pnl: +a.pnl.toFixed(2) }))
        .sort((x, y) => y.trades - x.trades);
    const stats = {
      total: entries.length,
      bySession: toRows(bySession),
      bySymbol: toRows(bySymbol),
      byDirection: toRows(byDirection),
      byEmotion: toRows(byEmotion),
      byWeekday: toRows(byWeekday),
    };

    // Findings dựa trên luật — luôn đúng với số liệu, không phụ thuộc AI
    const findings: string[] = [];
    const worst = (rows: { key: string; trades: number; winRate: number }[], min = 3) =>
      rows.filter((r) => r.trades >= min).sort((a, b) => a.winRate - b.winRate)[0];
    const best = (rows: { key: string; trades: number; winRate: number }[], min = 3) =>
      rows.filter((r) => r.trades >= min).sort((a, b) => b.winRate - a.winRate)[0];

    const ws = worst(stats.bySession);
    if (ws && ws.winRate < 45) findings.push(`Bạn thường thua khi giao dịch trong ${ws.key} (win rate ${ws.winRate}% trên ${ws.trades} lệnh).`);
    const bs = best(stats.bySession);
    if (bs && bs.winRate >= 55 && bs.key !== ws?.key) findings.push(`${bs.key} là khung giờ tốt nhất của bạn (win rate ${bs.winRate}% trên ${bs.trades} lệnh).`);
    const buy = stats.byDirection.find((r) => r.key === 'BUY');
    const sell = stats.byDirection.find((r) => r.key === 'SELL');
    if (buy && sell && buy.trades >= 3 && sell.trades >= 3 && Math.abs(buy.winRate - sell.winRate) >= 20) {
      const [good, bad] = buy.winRate > sell.winRate ? [buy, sell] : [sell, buy];
      findings.push(`Lệnh ${good.key} của bạn tốt hơn hẳn ${bad.key} (${good.winRate}% so với ${bad.winRate}%).`);
    }
    const we = worst(stats.byEmotion, 2);
    if (we && we.winRate < 40) findings.push(`Khi cảm xúc là "${we.key}", bạn thua nhiều bất thường (win rate ${we.winRate}% trên ${we.trades} lệnh).`);
    const wd = worst(stats.byWeekday);
    if (wd && wd.winRate < 40) findings.push(`${wd.key} là ngày tệ nhất của bạn (win rate ${wd.winRate}% trên ${wd.trades} lệnh).`);
    const wsym = worst(stats.bySymbol);
    if (wsym && wsym.winRate < 40) findings.push(`Cân nhắc tránh ${wsym.key}: win rate chỉ ${wsym.winRate}% trên ${wsym.trades} lệnh.`);
    const mistakes = entries.map((e) => e.mistakes?.trim()).filter(Boolean) as string[];
    if (mistakes.length >= 3) {
      const freq = new Map<string, number>();
      mistakes.forEach((m) => freq.set(m.toLowerCase(), (freq.get(m.toLowerCase()) ?? 0) + 1));
      const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top[1] >= 2) findings.push(`Lỗi lặp lại nhiều nhất: "${top[0]}" (${top[1]} lần).`);
    }
    if (!findings.length) findings.push('Chưa thấy điểm yếu rõ rệt nào — hãy tiếp tục ghi chép đầy đủ cảm xúc và lỗi để phân tích sâu hơn.');

    // AI viết tổng kết từ số liệu (nếu AI khả dụng)
    const aiSummary = await this.callLlm([
      {
        role: 'system',
        content: 'Bạn là huấn luyện viên giao dịch nói tiếng Việt. Dựa HOÀN TOÀN vào số liệu được cung cấp, viết 3-4 câu nhận xét thẳng thắn, cụ thể và 1 lời khuyên hành động. Không bịa số liệu. Không dùng markdown.',
      },
      {
        role: 'user',
        content:
          `Thống kê ${stats.total} lệnh đã đóng của tôi:\n` +
          `Theo phiên: ${stats.bySession.map((r) => `${r.key}: ${r.winRate}% win/${r.trades} lệnh/PnL ${r.pnl}$`).join(' | ')}\n` +
          `Theo chiều: ${stats.byDirection.map((r) => `${r.key}: ${r.winRate}%/${r.trades} lệnh`).join(' | ')}\n` +
          `Theo cảm xúc: ${stats.byEmotion.map((r) => `${r.key}: ${r.winRate}%/${r.trades}`).join(' | ') || 'không ghi'}\n` +
          `Theo thứ: ${stats.byWeekday.map((r) => `${r.key}: ${r.winRate}%/${r.trades}`).join(' | ')}\n` +
          `Phát hiện chính: ${findings.join(' ')}`,
      },
    ]);

    return { enough: true, message: null, stats, findings, aiSummary };
  }

  // ================= Setup lệnh: entry/SL/TP + theo dõi kết quả =================

  async createSetup(userId: string, symbolRaw: string) {
    const symbol = symbolRaw.toUpperCase();
    const [h1, h1c, spotQ, market] = await Promise.all([
      this.market.candles(symbol, '15m').catch(() => [] as Candle[]),
      this.market.candles(symbol, '1h').catch(() => [] as Candle[]),
      this.market.quote(symbol).catch(() => null),
      this.buildMarketContext(symbol, '15m'),
    ]);
    const spot = spotQ?.price ?? market.price;
    if (spot == null || h1.length < 60) {
      throw new ServiceUnavailableException(`Không đủ dữ liệu thị trường cho ${symbol}.`);
    }

    // EMA H1 — chỉ dùng làm dự phòng khi H1 chưa đủ dữ liệu để xác định cấu trúc (BOS/CHOCH)
    const h1Closes = h1c.map((c) => c.close);
    const h1e20 = ema(h1Closes, 20);
    const h1e50 = ema(h1Closes, 50);

    // Nến lệch giá thật → EMA/RSI/SMC đang tính trên dữ liệu sai, tuyệt đối không ra tín hiệu
    const lastClose = h1[h1.length - 1].close;
    const divergePct = Math.abs(lastClose - spot) / spot * 100;
    if (divergePct > 0.5) {
      return {
        noTrade: true,
        reason: `Dữ liệu nến đang trễ/lệch ${divergePct.toFixed(2)}% so với giá thật (nến M15: ${lastClose.toFixed(2)}, spot: ${spot}) — không tạo setup để tránh tín hiệu sai hàng loạt. Thử lại sau vài phút.`,
      };
    }

    // Mức hỗ trợ/kháng cự M15 quy về hệ giá spot (bù basis nếu nến là futures)
    const offM = spot - lastClose;
    const srLevels = swingLevels(h1);
    const supportsSpot = srLevels.supports.map((x) => x + offM);
    const resistancesSpot = srLevels.resistances.map((x) => x + offM);

    // ============ Phương pháp SMC (Smart Money Concept): cấu trúc, Order Block, FVG, thanh khoản ============
    // Đây là engine đã xây cho Giai đoạn 3 (trang SMC) — giờ tái dùng cho Setup lệnh thay vì chỉ
    // dựa vào EMA cross. Lý do: EMA20/50 là trung bình cộng dồn nên luôn trễ và dễ cho tín hiệu
    // "50-50" trong thị trường sideway; SMC bám theo hành động giá thật (nơi giá đảo chiều, nơi
    // thanh khoản bị quét) nên cho điểm vào/ra cụ thể hơn — dù không có phương pháp nào đảm bảo
    // thắng chắc, đây là khung phân tích có căn cứ rõ ràng hơn một đường trung bình đơn thuần.
    const m15Swings = detectSwings(h1);
    const m15Structure = detectStructure(h1, m15Swings);
    const shiftZone = (z: Zone) => ({ ...z, top: z.top + offM, bottom: z.bottom + offM });
    const unmitigatedOBs = detectOrderBlocks(h1, m15Structure).filter((z) => !z.mitigated).map(shiftZone);
    const unmitigatedFVGs = detectFVG(h1).filter((z) => !z.mitigated).map(shiftZone);
    const liquidity = detectEqualLevels(h1, m15Swings).map((e) => ({ ...e, price: e.price + offM }));

    // Xu hướng H1: ưu tiên BOS/CHOCH gần nhất (phản ứng ngay khi cấu trúc bị phá — không trễ
    // như EMA); chỉ dùng EMA khi H1 chưa có sự kiện cấu trúc nào để dựa vào.
    const h1Swings = detectSwings(h1c);
    const h1Structure = detectStructure(h1c, h1Swings);
    const lastH1Event = h1Structure[h1Structure.length - 1] ?? null;
    const h1Trend: 'TĂNG' | 'GIẢM' | null = lastH1Event
      ? (lastH1Event.direction === 'bull' ? 'TĂNG' : 'GIẢM')
      : (h1e20 != null && h1e50 != null ? (h1e20 >= h1e50 ? 'TĂNG' : 'GIẢM') : null);

    const smcText = [
      'CẤU TRÚC SMC (khung M15, mức giá đã quy về spot):',
      lastH1Event
        ? `H1 vừa ${lastH1Event.type} theo hướng ${lastH1Event.direction === 'bull' ? 'TĂNG' : 'GIẢM'} tại mốc ${(lastH1Event.price + offM).toFixed(2)}.`
        : 'H1 chưa có phá cấu trúc (BOS/CHOCH) rõ ràng gần đây — dùng EMA làm căn cứ xu hướng tạm thời.',
      unmitigatedOBs.length
        ? `Order Block M15 chưa bị lấp: ${unmitigatedOBs.slice(-5).map((z) => `${z.direction === 'bull' ? 'Bullish' : 'Bearish'} [${z.bottom.toFixed(2)}-${z.top.toFixed(2)}]`).join(', ')}`
        : 'Không có Order Block M15 nào còn hiệu lực.',
      unmitigatedFVGs.length
        ? `FVG M15 chưa bị lấp: ${unmitigatedFVGs.slice(-5).map((z) => `${z.direction === 'bull' ? 'Bullish' : 'Bearish'} [${z.bottom.toFixed(2)}-${z.top.toFixed(2)}]`).join(', ')}`
        : 'Không có FVG M15 nào còn hiệu lực.',
      liquidity.length
        ? `Vùng thanh khoản (EQH/EQL) chưa bị quét: ${liquidity.map((e) => `${e.kind} ${e.price.toFixed(2)}`).join(', ')}`
        : 'Chưa phát hiện vùng thanh khoản EQH/EQL rõ ràng.',
    ].join('\n');

    type Plan = { direction: 'BUY' | 'SELL'; entry: number; sl: number; tp: number; reasoning: string; source: string };
    const validate = (p: any): p is Plan => {
      if (!p || (p.direction !== 'BUY' && p.direction !== 'SELL')) return false;
      const nums = [p.entry, p.sl, p.tp].map(Number);
      if (nums.some((n) => !isFinite(n) || n <= 0)) return false;
      const [entry, sl, tp] = nums;
      if (Math.abs(entry - spot) / spot > 0.03) return false;
      if (p.direction === 'BUY' && !(sl < entry && entry < tp)) return false;
      if (p.direction === 'SELL' && !(tp < entry && entry < sl)) return false;
      const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
      return rr >= 0.5 && rr <= 10;
    };

    // Ưu tiên AI trả JSON theo phương pháp SMC; model yếu/hỏng thì dùng thuật toán
    // "Order Block Retest" dự phòng — cũng dựa trên engine SMC, không phải EMA.
    let plan: Plan | null = null;
    const raw = await this.callLlm([
      {
        role: 'system',
        content:
          'Bạn là chuyên gia Smart Money Concept (SMC/ICT). Ưu tiên vào lệnh tại Order Block hoặc Fair Value Gap CHƯA bị lấp, ' +
          'theo đúng hướng cấu trúc thị trường (BOS/CHOCH) trên H1, đặt SL ngoài vùng đó, và nhắm chốt lời tại vùng thanh khoản ' +
          '(EQH/EQL) hoặc Order Block đối diện gần nhất. Trả lời DUY NHẤT một khối JSON hợp lệ, không markdown, không văn bản nào khác.',
      },
      {
        role: 'user',
        content: `${market.text}\n\n${smcText}\n\nGiá ${symbol} HIỆN TẠI: ${spot}. XU HƯỚNG CẤU TRÚC H1: ${h1Trend ?? 'không rõ'}.\nĐề xuất 1 setup NGẮN HẠN khung M15 theo phương pháp SMC — ưu tiên entry tại rìa Order Block/FVG chưa bị lấp, SL ngoài vùng đó, TP tại vùng thanh khoản gần nhất.\nQUY TẮC QUAN TRỌNG:\n1. Ưu tiên giao dịch THEO xu hướng cấu trúc H1 (${h1Trend ?? '?'}). Chỉ đi ngược khi có BOS/CHOCH đảo chiều RẤT rõ (nêu cụ thể trong reasoning).\n2. Nếu KHÔNG có Order Block/FVG nào đủ gần giá theo đúng hướng, hoặc thị trường nhiễu → ĐỪNG ép lệnh, trả về {"direction":"NONE","reasoning":"lý do đứng ngoài"}. Đứng ngoài cũng là một quyết định tốt.\n3. TUYỆT ĐỐI KHÔNG SELL ngay tại vùng hỗ trợ, KHÔNG BUY ngay tại vùng kháng cự — TRỪ KHI đó chính là một Order Block/FVG hợp lệ theo đúng hướng lệnh (retest hợp lệ theo SMC).\nTrả về JSON: {"direction":"BUY"|"SELL"|"NONE","entry":số,"sl":số,"tp":số,"reasoning":"tiếng Việt, nêu rõ căn cứ Order Block/FVG/thanh khoản/cấu trúc"}\nRàng buộc khi có lệnh: entry trong ±2% giá hiện tại; BUY thì sl<entry<tp, SELL thì tp<entry<sl; RR từ 1 đến 5.`,
      },
    ], 0.2);
    if (raw) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          const j = JSON.parse(m[0]);
          if (j.direction === 'NONE') {
            return { noTrade: true, reason: String(j.reasoning ?? 'AI đánh giá chưa có setup xác suất cao — nên đứng ngoài.') };
          }
          const cand = { direction: j.direction, entry: +j.entry, sl: +j.sl, tp: +j.tp, reasoning: String(j.reasoning ?? ''), source: 'AI' };
          if (validate(cand)) plan = cand;
        } catch {}
      }
    }
    // Chặn lỗi logic kinh điển: SELL ngay tại hỗ trợ / BUY ngay tại kháng cự — TRỪ KHI đó là
    // một Order Block/FVG hợp lệ theo đúng hướng (retest chuẩn SMC thường trùng vùng S/R cũ).
    if (plan) {
      const aRef = atr(h1) ?? spot * 0.003;
      const nearLv = (levels: number[]) => levels.some((L) => Math.abs(plan!.entry - L) <= 0.6 * aRef);
      const inValidZone = [...unmitigatedOBs, ...unmitigatedFVGs].some(
        (z) =>
          plan!.entry >= z.bottom - aRef * 0.3 && plan!.entry <= z.top + aRef * 0.3 &&
          ((plan!.direction === 'BUY' && z.direction === 'bull') || (plan!.direction === 'SELL' && z.direction === 'bear')),
      );
      if (
        !inValidZone &&
        ((plan.direction === 'SELL' && nearLv(supportsSpot) && !nearLv(resistancesSpot)) ||
          (plan.direction === 'BUY' && nearLv(resistancesSpot) && !nearLv(supportsSpot)))
      ) {
        plan = null; // kế hoạch AI phạm nguyên tắc S/R → dùng thuật toán Order Block Retest dự phòng
      }
    }
    if (!plan) {
      if (!h1Trend) {
        return {
          noTrade: true,
          reason: 'Chưa xác định được xu hướng H1 (thiếu dữ liệu cấu trúc lẫn EMA) — đứng ngoài chờ dữ liệu rõ ràng hơn.',
        };
      }
      const bull = h1Trend === 'TĂNG';
      const aRef = atr(h1) ?? spot * 0.005;
      // Tìm Order Block M15 chưa bị lấp, đúng hướng H1, gần giá nhất (trong 3×ATR)
      const candidates = unmitigatedOBs
        .filter((z) => (bull ? z.direction === 'bull' : z.direction === 'bear'))
        .filter((z) => Math.abs(spot - (bull ? z.top : z.bottom)) <= aRef * 3)
        .sort((a, b) => Math.abs(spot - (bull ? a.top : a.bottom)) - Math.abs(spot - (bull ? b.top : b.bottom)));
      const ob = candidates[0];
      if (!ob) {
        return {
          noTrade: true,
          reason: `Xu hướng H1 là ${h1Trend} nhưng chưa có Order Block M15 nào (chưa bị lấp) đủ gần giá theo đúng hướng — chưa đủ điều kiện SMC để vào lệnh, đứng ngoài chờ giá tạo vùng mới.`,
        };
      }
      const entry = bull ? ob.top : ob.bottom; // chờ giá retest về rìa Order Block gần nhất
      const buffer = aRef * 0.15;
      const sl = bull ? ob.bottom - buffer : ob.top + buffer; // SL đặt ngoài Order Block
      const slDist = Math.abs(entry - sl);
      const liqTp = liquidity
        .filter((e) => (bull ? e.price > entry : e.price < entry))
        .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0]?.price;
      const tp = liqTp != null && Math.abs(liqTp - entry) / slDist >= 1 ? liqTp : (bull ? entry + slDist * 2 : entry - slDist * 2);
      plan = {
        direction: bull ? 'BUY' : 'SELL', entry, sl, tp,
        reasoning:
          `(Thuật toán SMC — Order Block Retest, AI không trả kế hoạch hợp lệ) H1 ${lastH1Event ? `vừa ${lastH1Event.type} hướng ${h1Trend}` : `theo EMA đang ${h1Trend}`}. ` +
          `Entry chờ giá retest rìa ${bull ? 'Bullish' : 'Bearish'} Order Block M15 [${ob.bottom.toFixed(2)}-${ob.top.toFixed(2)}] chưa bị lấp. SL đặt ngoài Order Block. ` +
          `TP ${liqTp != null ? `nhắm vùng thanh khoản gần nhất ${liqTp.toFixed(2)}` : 'theo RR 1:2 (chưa có vùng thanh khoản rõ ràng)'}. ⚠️ Chỉ tham khảo, chưa qua kiểm chứng thống kê — nên chạy thử ở trang Backtest (chiến lược "SMC BOS") trước khi tin tưởng.`,
        source: 'SMC',
      };
    }
    const rr = +(Math.abs(plan.tp - plan.entry) / Math.abs(plan.entry - plan.sl)).toFixed(2);
    return this.prisma.aiSetup.create({
      data: {
        userId, symbol,
        direction: plan.direction,
        entry: +plan.entry.toFixed(4), sl: +plan.sl.toFixed(4), tp: +plan.tp.toFixed(4),
        rr, reasoning: `[Xu hướng H1: ${h1Trend ?? 'không rõ'} | nến lệch spot ${divergePct.toFixed(2)}%] ${plan.reasoning}`.slice(0, 2000), source: plan.source,
      },
    });
  }

  /** Quét giá từ lúc tạo setup: khớp entry → RUNNING, chạm SL → LOSS, chạm TP → WIN (SL ưu tiên, bảo thủ) */
  private async checkSetups(userId: string) {
    const open = await this.prisma.aiSetup.findMany({
      where: { userId, status: { in: ['PENDING', 'RUNNING'] } },
    });
    const cache = new Map<string, Candle[]>();
    for (const s of open) {
      const ageDays = (Date.now() - s.createdAt.getTime()) / 86_400_000;
      const iv = (ageDays > 4 ? '1h' : '5m') as '5m' | '1h';
      const key = `${s.symbol}:${iv}`;
      if (!cache.has(key)) {
        let cs = await this.market.candles(s.symbol, iv).catch(() => [] as Candle[]);
        // Quy nến về cùng hệ giá spot với entry/SL/TP — nguồn futures (GC=F) lệch basis
        // sẽ làm lệnh chạm TP/SL thật mà hệ thống không nhận ra
        const q = await this.market.quote(s.symbol).catch(() => null);
        if (q?.price != null && cs.length) {
          const off = q.price - cs[cs.length - 1].close;
          if (Math.abs(off) / q.price > 0.0005) {
            cs = cs.map((c) => ({
              time: c.time,
              open: c.open + off, high: c.high + off, low: c.low + off, close: c.close + off,
            }));
          }
        }
        cache.set(key, cs);
      }
      const candles = cache.get(key)!;
      const startTs = Math.floor((s.triggeredAt ?? s.createdAt).getTime() / 1000);

      let status: string = s.status;
      let triggeredAt = s.triggeredAt;
      let closedAt: Date | null = null;
      for (const c of candles) {
        if (c.time < startTs) continue;
        if (status === 'PENDING' && c.low <= s.entry && s.entry <= c.high) {
          status = 'RUNNING';
          triggeredAt = new Date(c.time * 1000);
        }
        if (status === 'RUNNING') {
          const buy = s.direction === 'BUY';
          if (buy ? c.low <= s.sl : c.high >= s.sl) { status = 'LOSS'; closedAt = new Date(c.time * 1000); break; }
          if (buy ? c.high >= s.tp : c.low <= s.tp) { status = 'WIN'; closedAt = new Date(c.time * 1000); break; }
        }
      }
      if (status !== s.status) {
        await this.prisma.aiSetup.update({
          where: { id: s.id },
          data: { status: status as any, triggeredAt, closedAt },
        });
      }
    }
  }

  async listSetups(userId: string) {
    await this.checkSetups(userId).catch(() => {});
    return this.prisma.aiSetup.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }

  async cancelSetup(userId: string, id: string) {
    const s = await this.prisma.aiSetup.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException('Không tìm thấy setup');
    if (s.status !== 'PENDING' && s.status !== 'RUNNING') return s;
    return this.prisma.aiSetup.update({ where: { id }, data: { status: 'CANCELLED', closedAt: new Date() } });
  }

}
