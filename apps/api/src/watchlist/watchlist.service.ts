import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WatchlistService {
  constructor(private prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.watchlistItem.findMany({
      where: { userId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  add(userId: string, symbol: string, note?: string) {
    return this.prisma.watchlistItem.upsert({
      where: { userId_symbol: { userId, symbol: symbol.toUpperCase() } },
      update: { note },
      create: { userId, symbol: symbol.toUpperCase(), note },
    });
  }

  async remove(userId: string, id: string) {
    const item = await this.prisma.watchlistItem.findFirst({ where: { id, userId } });
    if (!item) throw new NotFoundException();
    return this.prisma.watchlistItem.delete({ where: { id } });
  }
}
