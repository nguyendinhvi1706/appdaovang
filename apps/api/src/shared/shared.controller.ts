import { Body, Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SharedService } from './shared.service';
import { PublishDto, SHARED_TYPES, SharedTypeVal } from './shared.dto';

@UseGuards(JwtAuthGuard)
@Controller('shared')
export class SharedController {
  constructor(private svc: SharedService) {}

  @Get()
  list(@Request() req: any, @Query('type') type?: string, @Query('q') q?: string) {
    const t = SHARED_TYPES.includes(type as SharedTypeVal) ? (type as SharedTypeVal) : undefined;
    return this.svc.list(req.user.id, t, q);
  }

  @Post()
  publish(@Request() req: any, @Body() dto: PublishDto) {
    return this.svc.publish(req.user.id, dto);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.svc.remove(req.user.id, id);
  }

  @Post(':id/like')
  like(@Request() req: any, @Param('id') id: string) {
    return this.svc.toggleLike(req.user.id, id);
  }

  @Post(':id/use')
  use(@Param('id') id: string) {
    return this.svc.use(id);
  }
}
