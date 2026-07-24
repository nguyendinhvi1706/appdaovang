import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Gửi báo lệnh entry/kết quả qua Telegram để người dùng không cần mở app liên tục.
 * Liên kết tài khoản qua deep-link "/start <userId>" — người dùng bấm nút trong app để mở chat
 * với bot, Telegram tự gửi userId kèm lệnh /start, server poll getUpdates để bắt và lưu chatId.
 * Không dùng webhook (đỡ phải có domain HTTPS cố định + endpoint public riêng) — polling đơn giản
 * và đủ dùng cho quy mô cá nhân/nhỏ.
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private offset = 0;

  constructor(private prisma: PrismaService) {}

  private get token(): string | undefined {
    return process.env.TELEGRAM_BOT_TOKEN;
  }

  async onModuleInit() {
    if (!this.token) return;
    // Bỏ qua toàn bộ update đang chờ sẵn khi server khởi động — tránh xử lý lại các lệnh /start cũ
    // (VD "chào lại" hoặc liên kết nhầm) mỗi lần Render free tier restart server.
    try {
      const pending = await this.fetchUpdates(0);
      const ids = pending.map((u: any) => u.update_id);
      this.offset = ids.length ? Math.max(...ids) + 1 : 0;
    } catch (e) {
      this.logger.warn(`Không lấy được update Telegram ban đầu: ${e}`);
    }
    setInterval(() => this.pollOnce().catch((e) => this.logger.warn(`Poll Telegram lỗi: ${e}`)), 4000);
  }

  private async fetchUpdates(offset: number): Promise<any[]> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/getUpdates?offset=${offset}&timeout=0`);
    const data: any = await res.json();
    return data?.ok ? data.result : [];
  }

  private async pollOnce() {
    if (!this.token) return;
    const updates = await this.fetchUpdates(this.offset);
    for (const u of updates) {
      this.offset = u.update_id + 1;
      const text: string | undefined = u.message?.text;
      const chatId: number | undefined = u.message?.chat?.id;
      if (!text || !chatId) continue;
      if (!text.startsWith('/start')) continue;

      const userId = text.split(' ')[1];
      if (!userId) {
        await this.sendMessage(String(chatId), 'Chào bạn! Hãy mở AppDaoVang → mục "Setup lệnh" → bấm "Kết nối Telegram" để liên kết đúng tài khoản.');
        continue;
      }
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        await this.sendMessage(String(chatId), 'Không tìm thấy tài khoản AppDaoVang tương ứng với liên kết này — hãy thử bấm lại nút "Kết nối Telegram" trong app.');
        continue;
      }
      await this.prisma.user.update({ where: { id: userId }, data: { telegramChatId: String(chatId) } });
      await this.sendMessage(
        String(chatId),
        '✅ <b>Đã kết nối Telegram thành công!</b>\nTừ giờ AppDaoVang sẽ báo cho bạn ngay khi có setup entry mới, khi giá khớp entry, và khi lệnh thắng/thua.',
      );
    }
  }

  async sendMessage(chatId: string, html: string) {
    if (!this.token) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
    } catch (e) {
      this.logger.warn(`Gửi Telegram lỗi: ${e}`);
    }
  }

  private esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private async chatIdOf(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
    return user?.telegramChatId ?? null;
  }

  async notifySetupCreated(
    userId: string,
    setup: { symbol: string; direction: string; entry: number; sl: number; tp: number; rr: number; source: string; reasoning: string },
  ) {
    const chatId = await this.chatIdOf(userId);
    if (!chatId) return;
    const dirIcon = setup.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL';
    const methodLabel = setup.source.startsWith('SK') ? 'SK System (Fibonacci)' : setup.source.startsWith('SMC') ? 'SMC (Order Block/FVG)' : setup.source;
    const reasonShort = this.esc(setup.reasoning).slice(0, 400);
    const text =
      `🆕 <b>SETUP MỚI — ${this.esc(setup.symbol)}</b>\n` +
      `${dirIcon}\n\n` +
      `🎯 Entry: <b>${setup.entry}</b>\n` +
      `🛑 SL: <b>${setup.sl}</b>\n` +
      `✅ TP: <b>${setup.tp}</b>\n` +
      `📊 RR: 1:${setup.rr}\n` +
      `🧠 Phương pháp: ${methodLabel}\n\n` +
      `<i>${reasonShort}</i>\n\n` +
      `⚠️ Setup tham khảo do thuật toán tạo, không phải lời khuyên đầu tư — không tự động đặt lệnh thật.`;
    await this.sendMessage(chatId, text);
  }

  async notifySetupEvent(
    userId: string,
    setup: { symbol: string; direction: string; entry: number; sl: number; tp: number },
    event: 'RUNNING' | 'WIN' | 'LOSS',
  ) {
    const chatId = await this.chatIdOf(userId);
    if (!chatId) return;
    const dirIcon = setup.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL';
    const meta: Record<string, { icon: string; title: string }> = {
      RUNNING: { icon: '🚀', title: 'ĐÃ KHỚP ENTRY' },
      WIN: { icon: '🎉', title: 'THẮNG — chạm Take Profit' },
      LOSS: { icon: '💔', title: 'THUA — chạm Stop Loss' },
    };
    const m = meta[event];
    const text =
      `${m.icon} <b>${m.title} — ${this.esc(setup.symbol)}</b>\n` +
      `${dirIcon}   Entry ${setup.entry} → SL ${setup.sl} / TP ${setup.tp}`;
    await this.sendMessage(chatId, text);
  }
}
