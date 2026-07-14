import { Module } from '@nestjs/common';
import { MarketModule } from '../market/market.module';
import { SmcController } from './smc.controller';
import { SmcService } from './smc.service';

@Module({
  imports: [MarketModule],
  controllers: [SmcController],
  providers: [SmcService],
})
export class SmcModule {}
