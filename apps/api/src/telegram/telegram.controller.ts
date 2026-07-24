import { BadRequestException, Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from './telegram.service';

class SaveTelegramConfigDto {
  @IsOptional() @IsString()
  botToken?: string;

  @IsOptional() @IsString()
  botUsername?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('telegram')
export class TelegramController {
  constructor(private telegram: TelegramService, private prisma: PrismaService) {}

  @Get('status')
  async status(@Request() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    const cfg = await this.telegram.getConfig();
    return {
      connected: !!user?.telegramChatId,
      configured: !!cfg.token && !!cfg.username,
      hasToken: !!cfg.token,
      botUsername: cfg.username ?? null,
      linkUrl: cfg.username ? `https://t.me/${cfg.username}?start=${req.user.id}` : null,
    };
  }

  @Post('config')
  async saveConfig(@Body() dto: SaveTelegramConfigDto) {
    if (!dto.botToken && !dto.botUsername) throw new BadRequestException('Thiếu token hoặc username bot.');
    await this.telegram.saveConfig(dto.botToken, dto.botUsername);
    return { ok: true };
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
