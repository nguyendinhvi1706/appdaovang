import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { TelegramModule } from '../telegram/telegram.module';
import { AiController } from './ai.controller';
import { CronController } from './cron.controller';
import { AiService } from './ai.service';

@Module({
  imports: [MarketModule, TelegramModule],
  controllers: [AiController, CronController],
  providers: [AiService],
})
export class AiModule {}
