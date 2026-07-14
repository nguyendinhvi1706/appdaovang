import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

@Module({
  imports: [MarketModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
