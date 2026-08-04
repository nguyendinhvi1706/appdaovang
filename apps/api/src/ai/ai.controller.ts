import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiService, ChatMessage } from './ai.service';

class ChatDto {
  @IsArray()
  messages: ChatMessage[];
}

class CreateSetupDto {
  @IsString()
  symbol: string;

  @IsOptional() @IsIn(['AUTO', 'BUY', 'SELL'])
  direction?: 'AUTO' | 'BUY' | 'SELL';

  @IsOptional() @IsIn(['SMC', 'SK', 'ICT'])
  method?: 'SMC' | 'SK' | 'ICT';
}

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private svc: AiService) {}

  @Post('chat')
  chat(@Request() req: any, @Body() dto: ChatDto) {
    return this.svc.chat(req.user.id, dto.messages);
  }

  @Get('journal-insights')
  journalInsights(@Request() req: any) {
    return this.svc.journalInsights(req.user.id);
  }

  @Post('setup')
  createSetup(@Request() req: any, @Body() dto: CreateSetupDto) {
    return this.svc.createSetup(req.user.id, dto.symbol, dto.direction ?? 'AUTO', dto.method ?? 'SMC');
  }

  @Get('setups')
  listSetups(@Request() req: any) {
    return this.svc.listSetups(req.user.id);
  }

  /** Xoá lịch sử setup của chính người dùng. `?keepOpen=1` để giữ lại lệnh đang chờ/đang chạy. */
  @Delete('setups')
  clearSetups(@Request() req: any, @Query('keepOpen') keepOpen?: string) {
    return this.svc.clearSetups(req.user.id, keepOpen === '1');
  }

  @Patch('setups/:id/cancel')
  cancelSetup(@Request() req: any, @Param('id') id: string) {
    return this.svc.cancelSetup(req.user.id, id);
  }
}
