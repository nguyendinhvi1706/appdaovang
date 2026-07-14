import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateJournalDto } from './journal.dto';

@Injectable()
export class JournalService {
  constructor(private prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.journalEntry.findMany({
      where: { userId },
      orderBy: { openedAt: 'desc' },
    });
  }

  create(userId: string, dto: CreateJournalDto, images: { before?: string; after?: string }) {
    return this.prisma.journalEntry.create({
      data: {
        ...dto,
        symbol: dto.symbol.toUpperCase(),
        userId,
        imageBefore: images.before,
        imageAfter: images.after,
      },
    });
  }

  async update(userId: string, id: string, dto: Partial<CreateJournalDto>, images: { before?: string; after?: string }) {
    await this.ensureOwner(userId, id);
    return this.prisma.journalEntry.update({
      where: { id },
      data: {
        ...dto,
        ...(images.before && { imageBefore: images.before }),
        ...(images.after && { imageAfter: images.after }),
        ...(dto.result && dto.result !== 'OPEN' && { closedAt: new Date() }),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwner(userId, id);
    return this.prisma.journalEntry.delete({ where: { id } });
  }

  async stats(userId: string) {
    const entries = await this.prisma.journalEntry.findMany({ where: { userId } });
    const closed = entries.filter((e) => e.result !== 'OPEN');
    const wins = closed.filter((e) => e.result === 'WIN').length;
    return {
      total: entries.length,
      open: entries.length - closed.length,
      wins,
      losses: closed.filter((e) => e.result === 'LOSS').length,
      winRate: closed.length ? +((wins / closed.length) * 100).toFixed(1) : 0,
      totalPnl: +closed.reduce((s, e) => s + (e.pnl ?? 0), 0).toFixed(2),
    };
  }

  private async ensureOwner(userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({ where: { id, userId } });
    if (!entry) throw new NotFoundException('Không tìm thấy lệnh');
  }
}
