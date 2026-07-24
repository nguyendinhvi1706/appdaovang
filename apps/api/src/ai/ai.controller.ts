import { Body, Controller, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
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

  @IsOptional() @IsIn(['SMC', 'SK'])
  method?: 'SMC' | 'SK';
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

  @Patch('setups/:id/cancel')
  cancelSetup(@Request() req: any, @Param('id') id: string) {
    return this.svc.cancelSetup(req.user.id, id);
  }
}
