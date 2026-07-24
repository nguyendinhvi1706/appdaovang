import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { Mt5AccountsModule } from './mt5-accounts/mt5-accounts.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { JournalModule } from './journal/journal.module';
import { MarketModule } from './market/market.module';
import { AiModule } from './ai/ai.module';
import { SmcModule } from './smc/smc.module';
import { BacktestModule } from './backtest/backtest.module';
import { SharedModule } from './shared/shared.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ServeStaticModule.forRoot({
      rootPath: join(process.cwd(), 'uploads'),
      serveRoot: '/uploads',
    }),
    PrismaModule,
    AuthModule,
    Mt5AccountsModule,
    WatchlistModule,
    JournalModule,
    MarketModule,
    AiModule,
    SmcModule,
    BacktestModule,
    SharedModule,
    MarketplaceModule,
    TelegramModule,
  ],
})
export class AppModule {}
