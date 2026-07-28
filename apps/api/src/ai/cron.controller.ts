import { Controller, Get, Logger, Query, UnauthorizedException } from '@nestjs/common';
import { AiService } from './ai.service';

/** Endpoint KHÔNG cần đăng nhập (JwtAuthGuard) — dùng cho dịch vụ ping ngoài (VD UptimeRobot) gọi
 *  định kỳ để chủ động quét + báo Telegram, thay vì chỉ trông chờ vòng lặp nền bên trong server
 *  (bị reset mỗi khi Render free tier "ngủ" rồi thức dậy). Bảo vệ bằng token đơn giản qua query
 *  string (không phải JWT thật, chỉ để tránh người lạ spam gọi tràn lan) — đặt biến môi trường
 *  CRON_SECRET trên Render, dùng chính token đó khi cấu hình URL trong UptimeRobot. */
@Controller('cron')
export class CronController {
  private readonly logger = new Logger(CronController.name);
  /** Chặn chồng lượt: nếu lượt quét trước còn đang chạy (quét chậm hơn chu kỳ ping) thì bỏ qua
   *  lượt mới thay vì chạy song song gây trùng setup và tốn quota API. */
  private running = false;

  constructor(private svc: AiService) {}

  @Get('scan')
  scan(@Query('token') token?: string) {
    const secret = process.env.CRON_SECRET;
    if (secret && token !== secret) throw new UnauthorizedException('Token không đúng.');

    if (this.running) return { ok: true, skipped: 'Lượt quét trước còn đang chạy' };

    // Trả lời NGAY, chạy quét ở nền: một lượt quét có thể mất vài chục giây (gọi AI cho nhiều
    // setup), trong khi UptimeRobot thường timeout ~30 giây và sẽ báo "down" nhầm nếu phải đợi.
    this.running = true;
    (async () => {
      try {
        await this.svc.checkAllOpenSetups().catch((e) => this.logger.warn(`Kiểm tra setup lỗi: ${e.message}`));
        const gen = await this.svc.autoGenerateSetups().catch((e) => {
          this.logger.warn(`Tự tạo setup lỗi: ${e.message}`);
          return null;
        });
        this.logger.log(`Cron scan xong${gen ? ` — tạo mới: ${gen.created}, đứng ngoài: ${gen.noTrade}` : ''}`);
      } finally {
        this.running = false;
      }
    })();

    return { ok: true, started: true, time: new Date().toISOString() };
  }
}
