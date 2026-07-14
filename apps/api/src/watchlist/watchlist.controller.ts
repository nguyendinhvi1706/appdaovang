import { Body, Controller, Delete, Get, Param, Post, Request, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { WatchlistService } from './watchlist.service';

class AddSymbolDto {
  @IsString()
  symbol: string;

  @IsOptional()
  @IsString()
  note?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('watchlist')
export class WatchlistController {
  constructor(private svc: WatchlistService) {}

  @Get()
  list(@Request() req: any) {
    return this.svc.list(req.user.id);
  }

  @Post()
  add(@Request() req: any, @Body() dto: AddSymbolDto) {
    return this.svc.add(req.user.id, dto.symbol, dto.note);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.svc.remove(req.user.id, id);
  }
}
