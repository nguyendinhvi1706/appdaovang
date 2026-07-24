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

  /** Cấu hình bot lấy từ DB (nhập ngay trong app) trước, thiếu thì rơi về biến môi trường —
   *  cho phép cấu hình trực tiếp trên giao diện mà không cần đụng tới Render dashboard. */
  async getConfig(): Promise<{ token?: string; username?: string }> {
    const rows = await this.prisma.appSetting.findMany({
      where: { key: { in: ['telegram_bot_token', 'telegram_bot_username'] } },
    });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      token: map['telegram_bot_token'] || process.env.TELEGRAM_BOT_TOKEN,
      username: map['telegram_bot_username'] || process.env.TELEGRAM_BOT_USERNAME,
    };
  }

  async saveConfig(botToken?: string, botUsername?: string) {
    if (botToken) {
      await this.prisma.appSetting.upsert({
        where: { key: 'telegram_bot_token' }, create: { key: 'telegram_bot_token', value: botToken }, update: { value: botToken },
      });
    }
    if (botUsername) {
      const clean = botUsername.replace(/^@/, '').trim();
      await this.prisma.appSetting.upsert({
        where: { key: 'telegram_bot_username' }, create: { key: 'telegram_bot_username', value: clean }, update: { value: clean },
      });
    }
    // Bỏ qua update cũ tích lũy trước khi có token (nếu có) để lần poll tới không xử lý nhầm
    this.offset = 0;
  }

  async onModuleInit() {
    // Không gate theo biến môi trường ở đây nữa — bot có thể được cấu hình sau, ngay trong app,
    // không cần restart server. Mỗi vòng poll tự đọc lại cấu hình mới nhất từ DB.
    setInterval(() => this.pollOnce().catch((e) => this.logger.warn(`Poll Telegram lỗi: ${e}`)), 4000);
  }

  private async fetchUpdates(token: string, offset: number): Promise<any[]> {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=0`);
    const data: any = await res.json();
    return data?.ok ? data.result : [];
  }

  private async pollOnce() {
    const { token } = await this.getConfig();
    if (!token) return;
    if (this.offset === 0) {
      // Mới bật/đổi cấu hình (hoặc mới khởi động) — bỏ qua toàn bộ update cũ đang chờ sẵn để
      // tránh xử lý lại các lệnh /start cũ mỗi lần Render free tier restart server.
      const pending = await this.fetchUpdates(token, 0);
      const ids = pending.map((u: any) => u.update_id);
      this.offset = ids.length ? Math.max(...ids) + 1 : 1;
      return;
    }
    const updates = await this.fetchUpdates(token, this.offset);
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
    const { token } = await this.getConfig();
    if (!token) return;
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
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
