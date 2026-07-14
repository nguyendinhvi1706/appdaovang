import { Module } from '@nestjs/common';
import { Mt5AccountsController } from './mt5-accounts.controller';
import { Mt5AccountsService } from './mt5-accounts.service';

@Module({
  controllers: [Mt5AccountsController],
  providers: [Mt5AccountsService],
})
export class Mt5AccountsModule {}
