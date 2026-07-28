import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { AiService } from './ai.service';

/** Endpoint KHÔNG cần đăng nhập (JwtAuthGuard) — dùng cho dịch vụ ping ngoài (VD UptimeRobot) gọi
 *  định kỳ để chủ động quét + báo Telegram, thay vì chỉ trông chờ vòng lặp nền bên trong server
 *  (bị reset mỗi khi Render free tier "ngủ" rồi thức dậy). Bảo vệ bằng token đơn giản qua query
 *  string (không phải JWT thật, chỉ để tránh người lạ spam gọi tràn lan) — đặt biến môi trường
 *  CRON_SECRET trên Render, dùng chính token đó khi cấu hình URL trong UptimeRobot. */
@Controller('cron')
export class CronController {
  constructor(private svc: AiService) {}

  @Get('scan')
  async scan(@Query('token') token?: string) {
    const secret = process.env.CRON_SECRET;
    if (secret && token !== secret) throw new UnauthorizedException('Token không đúng.');
    const [checked, generated] = await Promise.all([
      this.svc.checkAllOpenSetups().then(() => 'ok').catch((e) => `lỗi: ${e.message}`),
      this.svc.autoGenerateSetups().catch((e) => ({ error: e.message })),
    ]);
    return { ok: true, time: new Date().toISOString(), checkedSetups: checked, autoGenerate: generated };
  }
}
