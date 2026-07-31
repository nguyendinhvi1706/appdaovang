import { Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MarketService } from '../market/market.service';
import { TelegramService } from '../telegram/telegram.service';
import { atr, Candle, ema, rsi, swingLevels } from './indicators';
import { detectStructure, detectSwings, Swing } from '../smc/smc.engine';
// Dùng chung hàm với Backtest — bảo đảm logic chạy thật ĐÚNG BẰNG logic đã được đo lường
import { decideIctSetup, decideLiveSetup } from '../backtest/live-setup.strategy';

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** Tìm sóng 3 điểm gần nhất 0→A→B theo đúng loại điểm B mong muốn (dùng cho SK System: Fibonacci
 *  Retracement/Extension). B là swing gần hiện tại nhất đúng loại (điểm hồi), A là swing xen kẽ
 *  ngay trước B (đỉnh/đáy sóng dẫn đường), 0 là swing cùng loại B ngay trước A (điểm bắt đầu sóng). */
/** Nới Stop Loss ra xa nếu khoảng cách tới entry nhỏ hơn mức tối thiểu an toàn.
 *  Lý do: SL tính thuần theo cấu trúc (rìa Order Block, mốc Fibonacci 0.786) có thể chỉ cách entry
 *  1-5$ trên XAUUSD — nằm HẲN TRONG biên độ nhiễu bình thường của khung M15 (ATR thường 4-8$), nên
 *  gần như chắc chắn bị quét trước khi giá kịp đi tới TP, kể cả khi hướng phân tích đúng. Đây là
 *  nguyên nhân gốc của chuỗi thua liên tiếp toàn bộ do "chạm SL". */
function enforceMinStop(entry: number, sl: number, bull: boolean, minDist: number): number {
  if (Math.abs(entry - sl) >= minDist) return sl;
  return bull ? entry - minDist : entry + minDist;
}

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
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  /** Giá spot thật (Swissquote) lấy mẫu lượt quét gần nhất theo symbol — dùng làm điểm neo khi
   *  nguồn nến lịch sử đang là futures (GC=F) không đáng tin, để ghép 2 điểm liên tiếp thành
   *  1 khoảng giá đã đi qua giữa 2 lượt quét thay vì phải tin OHLC futures lệch basis. */
  private lastSpotBySymbol = new Map<string, number>();

  constructor(private prisma: PrismaService, private market: MarketService, private telegram: TelegramService) {}

  onModuleInit() {
    // Quét nền định kỳ để báo Telegram cả khi người dùng KHÔNG mở app (không phụ thuộc vào việc
    // họ tự bấm "Cập nhật kết quả"). Luôn bật (không gate theo env nữa) vì bot giờ cấu hình được
    // ngay trong app, có thể bật sau mà không cần restart server; nếu chưa có setup nào đang mở
    // thì vòng lặp gần như không tốn gì. Lưu ý: trên Render free tier, server có thể "ngủ" khi
    // không có traffic — vòng lặp này chỉ chạy trong lúc server đang thức; dùng dịch vụ ping miễn
    // phí (VD UptimeRobot) nếu muốn báo gần như tức thời.
    setInterval(() => {
      this.checkAllOpenSetups().catch(() => {});
    }, 90_000);

    // Tự động tìm setup mới cho người dùng đã kết nối Telegram — kể cả khi họ không mở app,
    // không bấm "Tạo setup mới". Chạy thưa hơn (15 phút) vì dựa trên khung M15/H1, tạo liên tục
    // không có ý nghĩa và tốn API thị trường + AI. Chạy lần đầu sau 20s (không đợi đủ 15 phút mới
    // có báo đầu tiên sau khi server vừa khởi động/deploy xong).
    setTimeout(() => this.autoGenerateSetups().catch(() => {}), 20_000);
    setInterval(() => {
      this.autoGenerateSetups().catch(() => {});
    }, 15 * 60_000);
  }

  /** Tự tạo setup (AUTO direction, cả 2 phương pháp SMC + SK) cho mọi user đã kết nối Telegram —
   *  theo watchlist của họ (rơi về XAUUSD nếu watchlist trống). Bỏ qua symbol/phương pháp nào đã
   *  có setup PENDING/RUNNING để tránh spam trùng lặp; noTrade thì im lặng bỏ qua, không báo. */
  async autoGenerateSetups() {
    const users = await this.prisma.user.findMany({
      where: { telegramChatId: { not: null } },
      select: { id: true },
    });
    let created = 0, skippedOpen = 0, noTrade = 0, errored = 0;
    for (const u of users) {
      const watch = await this.prisma.watchlistItem.findMany({ where: { userId: u.id }, take: 5 });
      const symbols = watch.length ? watch.map((w) => w.symbol) : ['XAUUSD'];
      const open = await this.prisma.aiSetup.findMany({
        where: { userId: u.id, status: { in: ['PENDING', 'RUNNING'] } },
        select: { symbol: true, source: true },
      });
      const hasOpen = (symbol: string, method: 'SMC' | 'SK') =>
        open.some((o) => o.symbol === symbol.toUpperCase() && o.source.startsWith(method));

      for (const symbol of symbols) {
        for (const method of ['SMC', 'SK'] as const) {
          if (hasOpen(symbol, method)) { skippedOpen++; continue; }
          try {
            const res: any = await this.createSetup(u.id, symbol, 'AUTO', method);
            if (res?.noTrade) noTrade++; else created++;
          } catch {
            errored++;
          }
        }
      }
    }
    const summary = { users: users.length, created, noTrade, skippedOpen, errored };
    this.logger.log(
      `Auto-scan: ${users.length} user đã nối Telegram | tạo mới: ${created} | đứng ngoài (chưa đủ điều kiện): ${noTrade} | bỏ qua (đã có lệnh mở): ${skippedOpen} | lỗi: ${errored}`,
    );
    return summary;
  }

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

  async createSetup(
    userId: string,
    symbolRaw: string,
    wantDirection: 'AUTO' | 'BUY' | 'SELL' = 'AUTO',
    method: 'SMC' | 'SK' | 'ICT' = 'SMC',
  ) {
    const symbol = symbolRaw.toUpperCase();
    // Ghi chú quan trọng: Yahoo Finance đã bỏ ticker "XAUUSD=X" (trả 404 thẳng, không phải trễ) nên
    // nến M15/H1 của vàng LUÔN rơi về futures GC=F. Không thể coi đây là lỗi tạm thời để chờ — phải
    // chấp nhận GC=F (đã bù basis bằng offM bên dưới) làm nguồn cho việc TẠO setup (rủi ro sai lệch
    // nhỏ trong cửa sổ phân tích ngắn hạn, đã có divergePct chặn khi lệch quá 0.5%). Việc THEO DÕI
    // setup đã tạo (checkOpenSetups) thì KHÔNG dùng futures nữa — dùng giá spot thật Swissquote real-
    // time — vì đó mới là chỗ đã từng báo sai WIN do basis trôi theo thời gian trong cả cửa sổ dài.
    const [h1Res, h1c, spotQ, market] = await Promise.all([
      this.market.candlesWithSource(symbol, '15m').catch(() => ({ data: [] as Candle[], ticker: null as string | null })),
      this.market.candles(symbol, '1h').catch(() => [] as Candle[]),
      this.market.quote(symbol).catch(() => null),
      this.buildMarketContext(symbol, '15m'),
    ]);
    const h1 = h1Res.data;
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

    // Bù basis nếu nến là futures (GC=F, trường hợp thường trực vì XAUUSD=X đã 404 trên Yahoo) —
    // quy toàn bộ mức giá SMC/Fibonacci bên dưới về hệ giá spot thật tại thời điểm hiện tại
    const offM = spot - lastClose;
    const aRef = atr(h1) ?? spot * 0.005;
    // Khoảng cách Stop Loss TỐI THIỂU: 1.5×ATR(M15) hoặc 0.1% giá — lấy giá trị lớn hơn. SL sát hơn
    // mức này nằm trong biên độ nhiễu thường ngày và sẽ bị quét gần như chắc chắn (xem enforceMinStop).
    const minSlDist = Math.max(aRef * 1.5, spot * 0.001);
    const m15Swings = detectSwings(h1);

    // Xu hướng H1: ưu tiên BOS/CHOCH gần nhất (phản ứng ngay khi cấu trúc bị phá — không trễ
    // như EMA); chỉ dùng EMA khi H1 chưa có sự kiện cấu trúc nào để dựa vào.
    const h1Swings = detectSwings(h1c);
    const h1Structure = detectStructure(h1c, h1Swings);
    const lastH1Event = h1Structure[h1Structure.length - 1] ?? null;
    const h1Trend: 'TĂNG' | 'GIẢM' | null = lastH1Event
      ? (lastH1Event.direction === 'bull' ? 'TĂNG' : 'GIẢM')
      : (h1e20 != null && h1e50 != null ? (h1e20 >= h1e50 ? 'TĂNG' : 'GIẢM') : null);

    // Ghi rõ sự kiện BOS/CHOCH xảy ra CÁCH ĐÂY BAO LÂU — tránh dùng chữ "vừa" cho một sự kiện
    // thực ra đã xảy ra nhiều giờ/ngày trước (chỉ là sự kiện gần nhất tìm được trong dữ liệu).
    const eventAgeH = lastH1Event ? (Date.now() / 1000 - lastH1Event.time) / 3600 : null;
    const eventAgeText = eventAgeH == null ? '' : eventAgeH < 1.5 ? 'vừa mới' : `cách đây khoảng ${Math.round(eventAgeH)} giờ`;

    // ============ Thuật toán quyết định số liệu — MỘT nguồn sự thật duy nhất ============
    // Trước đây để AI tự "nghĩ" cả entry/SL/TP bằng văn xuôi JSON: model yếu hay liệt kê nhiều
    // vùng thanh khoản rồi đổi ý giữa chừng (chain-of-thought rò rỉ vào câu trả lời), dẫn tới lời
    // giải thích không khớp con số hiển thị, và có lúc chọn nhầm TP không phải vùng gần nhất.
    // Sửa tận gốc: thuật toán tất định chọn số liệu (SMC hoặc SK System tùy `method`), AI chỉ được
    // giao NHIỆM VỤ DUY NHẤT là viết lại lý do bằng lời cho các con số đã chốt — không được đổi số.
    if (!h1Trend && wantDirection === 'AUTO') {
      return {
        noTrade: true,
        reason: 'Chưa xác định được xu hướng H1 (thiếu dữ liệu cấu trúc lẫn EMA) — đứng ngoài chờ dữ liệu rõ ràng hơn.',
      };
    }
    // AUTO: đi theo đúng xu hướng H1 (an toàn nhất, đã là mặc định từ trước). Nếu người dùng chủ
    // động chọn BUY hoặc SELL, cho phép tạo cả lệnh ngược xu hướng — nhưng phải cảnh báo rõ ràng
    // trong lý do, không được ngầm coi đó là lệnh thuận xu hướng.
    const bull = wantDirection === 'AUTO' ? h1Trend === 'TĂNG' : wantDirection === 'BUY';
    const counterTrend = wantDirection !== 'AUTO' && h1Trend != null &&
      ((wantDirection === 'BUY' && h1Trend === 'GIẢM') || (wantDirection === 'SELL' && h1Trend === 'TĂNG'));
    const direction: 'BUY' | 'SELL' = bull ? 'BUY' : 'SELL';
    const trendClause = h1Trend
      ? (lastH1Event ? `${eventAgeText} có ${lastH1Event.type} xác nhận xu hướng ${h1Trend.toLowerCase()}` : `theo EMA đang ${h1Trend.toLowerCase()}`)
      : 'chưa xác định rõ ràng (thiếu cả cấu trúc BOS/CHOCH lẫn EMA), thực hiện theo hướng bạn tự chọn';
    const warnClause = counterTrend
      ? ` ⚠️ Đây là lệnh NGƯỢC xu hướng H1 hiện tại (đang ${h1Trend?.toLowerCase()}) theo lựa chọn thủ công của bạn — rủi ro cao hơn lệnh thuận xu hướng, chỉ nên vào khi có tín hiệu đảo chiều mạnh và quản lý vốn chặt chẽ.`
      : '';

    let entry: number, sl: number, tp: number, rr: number;
    let templateReason: string, aiSystemMsg: string, aiUserMsg: string, sourceTag: string;

    if (method === 'SK') {
      // ============ SK System: Fibonacci Retracement + Extension (sóng 3 điểm 0→A→B) ============
      // Kỹ thuật kinh điển: xác nhận xu hướng bằng sóng dẫn đường 0→A, chờ giá hồi về vùng "tỉ lệ
      // vàng" Fibonacci Retracement 0.5-0.667 của sóng đó để vào lệnh, SL sau mốc 0.786, TP đo bằng
      // Fibonacci Extension chiếu từ điểm hồi B. Toàn bộ số liệu tính từ swing thật trên M15 — AI
      // không được tự chọn điểm sóng hay số liệu, chỉ diễn giải.
      const wantKind: 'high' | 'low' = bull ? 'low' : 'high';
      const wave = pickWave(m15Swings, wantKind);
      const validWave = wave && (bull ? wave.sB.price > wave.s0.price : wave.sB.price < wave.s0.price);
      if (!validWave) {
        return {
          noTrade: true,
          reason: `Chưa tìm được sóng ${bull ? 'tăng' : 'giảm'} 3 điểm (0→A→B) hợp lệ theo cấu trúc SK System trên M15 (cần ${bull ? 'đáy sau cao hơn đáy trước' : 'đỉnh sau thấp hơn đỉnh trước'}) — đứng ngoài chờ sóng mới hình thành.`,
        };
      }
      const s0P = wave!.s0.price + offM, sAP = wave!.sA.price + offM, sBP = wave!.sB.price + offM;
      const range = Math.abs(sAP - s0P);
      const fibLevel = (r: number) => (bull ? sAP - r * range : sAP + r * range);
      entry = fibLevel(0.618); // điểm "tỉ lệ vàng" giữa vùng 0.5-0.667
      const slFib = fibLevel(0.786);
      // Đệm 0.5×ATR (trước đây 0.15×ATR — quá mỏng): dải Fibonacci 0.618→0.786 chỉ chiếm 16.8% biên
      // sóng, nên nếu sóng nhỏ thì SL chỉ cách entry vài đô. Cộng thêm ngưỡng sàn minSlDist bên dưới.
      const buffer = aRef * 0.5;
      sl = enforceMinStop(entry, bull ? slFib - buffer : slFib + buffer, bull, minSlDist);
      const slDist = Math.abs(entry - sl);

      // Chọn tỉ lệ Extension nhỏ nhất cho RR nằm trong khoảng HỢP LÝ 1:1.5 - 1:5. Trước đây chỉ yêu
      // cầu RR ≥ 1:1 nên mốc nhỏ nhất luôn thoả (vì SL quá sát), sinh ra mục tiêu cách 90$ trên khung
      // M15 — RR trên giấy rất đẹp nhưng xác suất chạm gần như không có.
      const ratios = [1.272, 1.382, 1.618, 1.809, 2];
      const minRR = 1.5, maxRR = 5;
      let usedRatio: number | null = null;
      tp = bull ? entry + slDist * 2.5 : entry - slDist * 2.5;
      for (const r of ratios) {
        const cand = bull ? sBP + r * range : sBP - r * range;
        const candRR = Math.abs(cand - entry) / slDist;
        if (candRR >= minRR && candRR <= maxRR) { tp = cand; usedRatio = r; break; }
      }
      rr = +(Math.abs(tp - entry) / slDist).toFixed(2);

      // Nếu giá đã vượt qua SL hoặc đã tới TP dự kiến trước khi kịp tạo setup → sóng đã vô hiệu
      const invalidated = bull ? (spot <= sl || spot >= tp) : (spot >= sl || spot <= tp);
      if (invalidated) {
        return {
          noTrade: true,
          reason: 'Sóng Fibonacci vừa xác định đã bị vô hiệu — giá đã vượt qua vùng Stop Loss hoặc đã đạt vùng Take Profit dự kiến trước khi kịp tạo setup. Đứng ngoài chờ sóng mới.',
        };
      }

      const skText = [
        'CẤU TRÚC SK SYSTEM (Fibonacci Retracement/Extension, khung M15, mức giá đã quy về spot):',
        lastH1Event
          ? `H1 ${eventAgeText} có tín hiệu ${lastH1Event.type} theo hướng ${lastH1Event.direction === 'bull' ? 'TĂNG' : 'GIẢM'} tại mốc ${(lastH1Event.price + offM).toFixed(2)}.`
          : 'H1 chưa có phá cấu trúc (BOS/CHOCH) rõ ràng gần đây — dùng EMA làm căn cứ xu hướng tạm thời.',
        `Sóng dẫn đường 0→A: từ ${s0P.toFixed(2)} đến ${sAP.toFixed(2)}. Điểm B (điểm hồi gần nhất): ${sBP.toFixed(2)} — ${bull ? 'cao hơn' : 'thấp hơn'} điểm 0, xác nhận cấu trúc ${bull ? 'tăng' : 'giảm'} còn hiệu lực.`,
        `Vùng vào lệnh (Fibonacci Retracement 0.5-0.667 của sóng 0-A): ${fibLevel(0.5).toFixed(2)} - ${fibLevel(0.667).toFixed(2)}.`,
      ].join('\n');

      templateReason =
        `Cấu trúc H1 ${trendClause}. ` +
        `Trên M15 xác định sóng ${bull ? 'tăng' : 'giảm'} 3 điểm theo SK System: điểm 0 tại ${s0P.toFixed(2)}, điểm A tại ${sAP.toFixed(2)}, điểm B (hồi gần nhất) tại ${sBP.toFixed(2)} — ${bull ? 'đáy sau cao hơn đáy trước' : 'đỉnh sau thấp hơn đỉnh trước'}, xác nhận cấu trúc ${bull ? 'tăng' : 'giảm'} còn hiệu lực. ` +
        `Chờ giá hồi về vùng Fibonacci Retracement 0.5-0.667 (điểm vào ${entry.toFixed(2)}) để vào ${direction}. ` +
        `Stop Loss đặt sau mốc Fibonacci 0.786 tại ${sl.toFixed(2)} (đã nới tối thiểu 1.5×ATR để không bị quét bởi nhiễu thường ngày). ` +
        (usedRatio
          ? `Take Profit đặt tại mốc Fibonacci Extension ${usedRatio} chiếu từ điểm B (${tp.toFixed(2)}), đạt tỷ lệ Risk:Reward 1:${rr}.`
          : `Không mốc Fibonacci Extension nào cho RR hợp lý trong khoảng 1:1.5-1:5 nên Take Profit dùng mức RR 1:2.5 mặc định (${tp.toFixed(2)}).`) + warnClause;

      aiSystemMsg =
        'Bạn là chuyên gia phân tích Fibonacci Retracement/Extension (SK System) viết tiếng Việt. Nhiệm vụ DUY NHẤT: diễn giải lại một quyết định giao dịch ĐÃ CÓ SẴN ' +
        'thành 2-3 câu văn mạch lạc. TUYỆT ĐỐI không đề xuất số liệu khác, không liệt kê nhiều phương án, không đổi entry/SL/TP đã cho.';
      aiUserMsg =
        `${skText}\n\n` +
        `Setup đã được thuật toán SK System (Fibonacci) chốt từ dữ liệu trên — các con số dưới đây là CUỐI CÙNG, không được đổi:\n` +
        `- Hướng: ${direction}\n- Entry: ${entry.toFixed(2)} (Fibonacci Retracement 0.618 của sóng 0-A)\n` +
        `- Stop Loss: ${sl.toFixed(2)} (sau mốc Fibonacci 0.786, nới tối thiểu 1.5×ATR)\n- Take Profit: ${tp.toFixed(2)} (${usedRatio ? `Fibonacci Extension ${usedRatio} chiếu từ điểm B` : 'RR 1:2.5 mặc định — không mốc Extension nào cho RR hợp lý'})\n- RR: 1:${rr}\n` +
        `- Xu hướng H1: ${h1Trend ?? 'chưa xác định rõ'}${lastH1Event ? ` (${eventAgeText} có ${lastH1Event.type})` : ' (theo EMA, H1 chưa có phá cấu trúc)'}\n` +
        (counterTrend ? `- LƯU Ý BẮT BUỘC: đây là lệnh NGƯỢC xu hướng H1 do người dùng tự chọn hướng — PHẢI nêu rõ trong câu giải thích rằng đây là lệnh ngược xu hướng, rủi ro cao hơn.\n` : '') +
        `\nViết 2-3 câu tiếng Việt giải thích NGẮN GỌN vì sao chọn đúng các con số này. Không liệt kê phương án khác, không đổi số.`;
      sourceTag = 'SK';
    } else if (method === 'ICT') {
      // ============ ICT: quét thanh khoản + Killzone + Premium/Discount ============
      // Dùng LẠI ĐÚNG hàm đã chạy backtest (decideIctSetup) thay vì viết lại — để logic chạy thật và
      // logic được đo lường không bao giờ lệch nhau. Đây là bài học rút ra từ chính dự án này: trước
      // đây Backtest và Setup lệnh dùng hai bộ công thức khác nhau nên mọi con số backtest đều vô nghĩa.
      const ictRaw = decideIctSetup(h1);
      if (!ictRaw) {
        return {
          noTrade: true,
          reason:
            'Chưa đủ điều kiện ICT: cần đồng thời (1) đang trong Killzone London 07-10h hoặc New York 12-15h giờ UTC, ' +
            '(2) giá nằm đúng nửa Discount (để BUY) hoặc Premium (để SELL) của dealing range, ' +
            '(3) vừa có cú quét thủng đáy/đỉnh cũ rồi đóng cửa ngược lại, và (4) giá chưa hồi qua mốc vào lệnh OTE 0.705. Đứng ngoài chờ.',
        };
      }
      // ICT tự xác định hướng từ xu hướng H1 + vị trí Premium/Discount, không nhận hướng ép từ ngoài.
      // Nếu người dùng chọn tay ngược lại thì phải từ chối, không được ghi setup với hướng sai lệch.
      if (ictRaw.direction !== direction) {
        return {
          noTrade: true,
          reason: `Bạn chọn ${direction} nhưng cấu trúc ICT hiện tại chỉ cho tín hiệu ${ictRaw.direction} (theo xu hướng H1 và vị trí Premium/Discount). Không tạo setup ngược tín hiệu.`,
        };
      }
      // Quy các mức về hệ giá spot hiện tại (giống các nhánh khác)
      entry = ictRaw.entry + offM;
      sl = ictRaw.sl + offM;
      tp = ictRaw.tp + offM;
      rr = ictRaw.rr;
      const ictDir = ictRaw.direction;

      templateReason =
        `⚠️ CẢNH BÁO: phương pháp ICT này ĐÃ ĐƯỢC KIỂM CHỨNG BẰNG BACKTEST TRÊN DỮ LIỆU THẬT VÀ CHO KẾT QUẢ LỖ trên mọi khung thời gian. ` +
        `Setup dưới đây chỉ để tham khảo/học tập, KHÔNG nên dùng để vào lệnh tiền thật. ` +
        `Cấu trúc H1 ${trendClause}. ` +
        `Giá vừa quét thủng mốc thanh khoản cũ rồi đóng cửa ngược lại (stop hunt) trong Killzone, và đang ở nửa ${ictDir === 'BUY' ? 'Discount (dưới trung điểm)' : 'Premium (trên trung điểm)'} của dealing range. ` +
        `Chờ giá hồi về mốc OTE 0.705 tại ${entry.toFixed(2)} để vào ${ictDir}. ` +
        `Stop Loss ngoài điểm quét tại ${sl.toFixed(2)} (nới tối thiểu 1.5×ATR). ` +
        `Take Profit tại vùng thanh khoản đối diện ${tp.toFixed(2)}, tỷ lệ Risk:Reward 1:${rr}.` + warnClause;

      aiSystemMsg =
        'Bạn là chuyên gia phân tích ICT viết tiếng Việt. Nhiệm vụ DUY NHẤT: diễn giải lại một quyết định giao dịch ĐÃ CÓ SẴN thành 2-3 câu. ' +
        'BẮT BUỘC nêu rõ ngay câu đầu rằng phương pháp này đã backtest ra kết quả LỖ và chỉ mang tính tham khảo. ' +
        'TUYỆT ĐỐI không đề xuất số liệu khác, không đổi entry/SL/TP đã cho.';
      aiUserMsg =
        `Setup đã được thuật toán ICT chốt — các con số là CUỐI CÙNG, không được đổi:\n` +
        `- Hướng: ${ictDir}\n- Entry: ${entry.toFixed(2)} (OTE 0.705 sau cú quét thanh khoản)\n` +
        `- Stop Loss: ${sl.toFixed(2)} (ngoài điểm quét)\n- Take Profit: ${tp.toFixed(2)} (vùng thanh khoản đối diện)\n- RR: 1:${rr}\n` +
        `- Xu hướng H1: ${h1Trend ?? 'chưa xác định rõ'}\n` +
        `- BẮT BUỘC: nêu rõ phương pháp ICT này đã được backtest và cho kết quả LỖ, chỉ nên dùng để tham khảo.\n` +
        `\nViết 2-3 câu tiếng Việt ngắn gọn. Không liệt kê phương án khác, không đổi số.`;
      sourceTag = 'ICT';
    } else {
      // ============ SMC "Setup A+": Sweep → CHOCH → Order Block + FVG hợp lưu ============
      // Dùng LẠI ĐÚNG hàm đã chạy backtest (decideLiveSetup) thay vì công thức riêng — nếu không,
      // Backtest và Setup lệnh lại chạy hai bộ luật khác nhau và mọi con số đo được đều vô nghĩa.
      const smcRaw = decideLiveSetup(h1, 'SMC');
      if (!smcRaw) {
        return {
          noTrade: true,
          reason:
            'Chưa đủ điều kiện Setup A+: cần đủ chuỗi (1) cấu trúc H4 rõ ràng HH+HL hoặc LL+LH, ' +
            '(2) có cú quét thanh khoản vào Equal Low/High, PDL/PDH hoặc swing cũ, ' +
            '(3) sau đó phá cấu trúc CHOCH, (4) có Order Block là nến ngược chiều cuối trước cú đẩy, ' +
            '(5) có FVG trong cú đẩy và CHỒNG LÊN Order Block, (6) giá chưa hồi qua vùng hợp lưu, ' +
            'và (7) có mục tiêu thanh khoản cho RR 1:1.5-1:5. Đứng ngoài chờ setup đủ điều kiện.',
        };
      }
      if (smcRaw.direction !== direction) {
        return {
          noTrade: true,
          reason: `Bạn chọn ${direction} nhưng cấu trúc H4 hiện tại chỉ cho phép ${smcRaw.direction} (theo quy tắc HH+HL / LL+LH). Không tạo setup ngược cấu trúc.`,
        };
      }
      entry = smcRaw.entry + offM;
      sl = smcRaw.sl + offM;
      tp = smcRaw.tp + offM;
      rr = smcRaw.rr;

      templateReason =
        `Cấu trúc H4 ${smcRaw.direction === 'BUY' ? 'tăng (HH + HL)' : 'giảm (LL + LH)'}. ` +
        `Giá đã quét thanh khoản (Equal Low/High, PDL/PDH hoặc swing cũ) rồi phá cấu trúc CHOCH, xác nhận đổi quyền kiểm soát. ` +
        `Điểm vào ${entry.toFixed(2)} đặt tại vùng Order Block và FVG chồng nhau — hợp lưu hai dấu vết của cùng cú đẩy. ` +
        `Stop Loss ${sl.toFixed(2)} đặt ngoài đáy/đỉnh cú quét (không đặt sát Order Block vì dễ bị quét lại). ` +
        `Take Profit ${tp.toFixed(2)} tại vùng thanh khoản đối diện theo cấu trúc, tỷ lệ Risk:Reward 1:${rr}.` + warnClause;

      aiSystemMsg =
        'Bạn là chuyên gia phân tích SMC/ICT viết tiếng Việt. Nhiệm vụ DUY NHẤT: diễn giải lại một quyết định giao dịch ĐÃ CÓ SẴN ' +
        'thành 2-3 câu văn mạch lạc. TUYỆT ĐỐI không đề xuất số liệu khác, không liệt kê nhiều phương án, không đổi entry/SL/TP đã cho.';
      aiUserMsg =
        `Setup A+ đã được thuật toán chốt — các con số là CUỐI CÙNG, không được đổi:\n` +
        `- Hướng: ${direction}\n- Entry: ${entry.toFixed(2)} (vùng Order Block + FVG chồng nhau)\n` +
        `- Stop Loss: ${sl.toFixed(2)} (ngoài đáy/đỉnh cú quét thanh khoản)\n- Take Profit: ${tp.toFixed(2)} (vùng thanh khoản đối diện)\n- RR: 1:${rr}\n` +
        `- Chuỗi xác nhận: cấu trúc H4 → quét thanh khoản → CHOCH → Order Block + FVG hợp lưu\n` +
        (counterTrend ? `- LƯU Ý BẮT BUỘC: nêu rõ đây là lệnh ngược xu hướng, rủi ro cao hơn.\n` : '') +
        `\nViết 2-3 câu tiếng Việt giải thích NGẮN GỌN. Không liệt kê phương án khác, không đổi số.`;
      sourceTag = 'SMC';
    }

    // AI chỉ được giao viết lại lời giải cho số liệu ĐÃ CHỐT — không được tạo hay đổi số mới
    const aiReason = await this.callLlm([
      { role: 'system', content: aiSystemMsg },
      { role: 'user', content: aiUserMsg },
    ], 0.2);

    const finalReasoning = (aiReason?.trim() || templateReason).slice(0, 1500);
    const created = await this.prisma.aiSetup.create({
      data: {
        userId, symbol, direction,
        entry: +entry.toFixed(4), sl: +sl.toFixed(4), tp: +tp.toFixed(4), rr,
        reasoning: `[Xu hướng H1: ${h1Trend ?? 'chưa xác định'} | nến lệch spot ${divergePct.toFixed(2)}%${counterTrend ? ' | ⚠️ NGƯỢC XU HƯỚNG (chọn thủ công)' : ''}] ${finalReasoning}`.slice(0, 2000),
        source: aiReason ? sourceTag : `${sourceTag}-ALGO`,
      },
    });
    this.telegram.notifySetupCreated(userId, created).catch(() => {});
    return created;
  }

  /** Quét giá từ lúc tạo setup: khớp entry → RUNNING, chạm SL → LOSS, chạm TP → WIN (SL ưu tiên, bảo thủ).
   *  Dùng chung cho cả đường tương tác (user tự mở app) lẫn vòng lặp nền báo Telegram (mọi user). */
  private async checkOpenSetups(where: Prisma.AiSetupWhereInput) {
    const open = await this.prisma.aiSetup.findMany({ where });
    const cache = new Map<string, Candle[]>();
    for (const s of open) {
      const key = s.symbol;
      if (!cache.has(key)) {
        // Theo dõi LUÔN dùng giá spot thật tức thời (Swissquote — miễn phí, không giới hạn request,
        // real-time), không dùng lại nến lịch sử từ nguồn ngoài (OANDA/Twelve Data/GC=F) nữa. Lý do
        // kép: (1) tránh lặp lại đúng lỗi basis-drift từng khiến hệ thống báo sai WIN trong khi giá
        // spot thật chưa từng chạm TP; (2) các API nến miễn phí đều giới hạn số request/ngày khá
        // thấp, chỉ nên dành cho việc TẠO setup (gọi ít hơn nhiều), không dùng cho vòng quét mỗi
        // ~90 giây này. Ghép giá lượt quét này với lượt quét TRƯỚC thành 1 "nến tổng hợp" [thấp
        // nhất, cao nhất] để không bỏ sót biến động giữa 2 lượt.
        const q = await this.market.quote(s.symbol).catch(() => null);
        const prev = this.lastSpotBySymbol.get(s.symbol);
        let cs: Candle[];
        if (q?.price != null) {
          cs = prev != null
            ? [{
                time: Math.floor(Date.now() / 1000),
                open: prev, close: q.price,
                high: Math.max(prev, q.price), low: Math.min(prev, q.price),
              }]
            : [];
          this.lastSpotBySymbol.set(s.symbol, q.price);
        } else {
          cs = [];
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
        // Báo Telegram đúng lúc trạng thái đổi (idempotent: lần quét sau thấy status đã khớp DB
        // nên không gửi lại) — hoạt động cả từ vòng lặp nền lẫn khi user tự mở app.
        if (status === 'RUNNING' || status === 'WIN' || status === 'LOSS') {
          this.telegram.notifySetupEvent(s.userId, s, status).catch(() => {});
        }
      }
    }
  }

  private async checkSetups(userId: string) {
    await this.checkOpenSetups({ userId, status: { in: ['PENDING', 'RUNNING'] } });
  }

  /** Quét toàn bộ setup đang mở của MỌI người dùng — dùng cho vòng lặp nền báo Telegram định kỳ. */
  async checkAllOpenSetups() {
    await this.checkOpenSetups({ status: { in: ['PENDING', 'RUNNING'] } });
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
