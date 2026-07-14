import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Mt5AccountsService } from './mt5-accounts.service';
import { CreateMt5AccountDto } from './mt5-accounts.dto';

@UseGuards(JwtAuthGuard)
@Controller('mt5-accounts')
export class Mt5AccountsController {
  constructor(private svc: Mt5AccountsService) {}

  @Get()
  list(@Request() req: any) {
    return this.svc.list(req.user.id);
  }

  @Post()
  create(@Request() req: any, @Body() dto: CreateMt5AccountDto) {
    return this.svc.create(req.user.id, dto);
  }

  @Patch(':id')
  update(@Request() req: any, @Param('id') id: string, @Body() dto: Partial<CreateMt5AccountDto>) {
    return this.svc.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.svc.remove(req.user.id, id);
  }
}
