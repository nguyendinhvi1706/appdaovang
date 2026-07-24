import { BadRequestException, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

@UseGuards(JwtAuthGuard)
@Controller('telegram')
export class TelegramController {
  constructor(private telegram: TelegramService, private prisma: PrismaService) {}

  @Get('status')
  async status(@Request() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    const botUsername = process.env.TELEGRAM_BOT_USERNAME;
    return {
      connected: !!user?.telegramChatId,
      configured: !!process.env.TELEGRAM_BOT_TOKEN && !!botUsername,
      linkUrl: botUsername ? `https://t.me/${botUsername}?start=${req.user.id}` : null,
    };
  }

  @Post('test')
  async test(@Request() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.telegramChatId) throw new BadRequestException('Chưa kết nối Telegram — hãy bấm "Kết nối Telegram" trước.');
    await this.telegram.sendMessage(user.telegramChatId, '🔔 Đây là tin nhắn thử từ AppDaoVang — kết nối đang hoạt động tốt!');
    return { ok: true };
  }

  @Post('disconnect')
  async disconnect(@Request() req: any) {
    await this.prisma.user.update({ where: { id: req.user.id }, data: { telegramChatId: null } });
    return { ok: true };
  }
}
