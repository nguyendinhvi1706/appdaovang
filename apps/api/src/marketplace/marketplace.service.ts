import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateItemDto, MarketCategoryVal } from './marketplace.dto';

@Injectable()
export class MarketplaceService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, category?: MarketCategoryVal, q?: string) {
    const items = await this.prisma.marketItem.findMany({
      where: {
        ...(category && { category }),
        ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }),
      },
      include: {
        author: { select: { name: true } },
        ratings: { select: { userId: true, stars: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return items.map((i) => ({
      id: i.id, category: i.category, title: i.title, description: i.description,
      content: i.content, fileUrl: i.fileUrl, fileName: i.fileName, version: i.version,
      downloads: i.downloads, createdAt: i.createdAt,
      author: i.author.name ?? 'Ẩn danh',
      isMine: i.authorId === userId,
      ratingCount: i.ratings.length,
      avgRating: i.ratings.length ? +(i.ratings.reduce((s, r) => s + r.stars, 0) / i.ratings.length).toFixed(1) : null,
      myRating: i.ratings.find((r) => r.userId === userId)?.stars ?? null,
    }));
  }

  create(userId: string, dto: CreateItemDto, file?: { url: string; name: string }) {
    return this.prisma.marketItem.create({
      data: { ...dto, authorId: userId, fileUrl: file?.url, fileName: file?.name },
    });
  }

  async remove(userId: string, id: string) {
    const item = await this.prisma.marketItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException();
    if (item.authorId !== userId) throw new ForbiddenException('Chỉ tác giả mới xóa được');
    return this.prisma.marketItem.delete({ where: { id } });
  }

  async rate(userId: string, itemId: string, stars: number) {
    const s = Math.min(5, Math.max(1, Math.round(stars)));
    await this.prisma.marketRating.upsert({
      where: { userId_itemId: { userId, itemId } },
      update: { stars: s },
      create: { userId, itemId, stars: s },
    });
    return { stars: s };
  }

  async download(id: string) {
    const item = await this.prisma.marketItem.update({
      where: { id },
      data: { downloads: { increment: 1 } },
    });
    return { fileUrl: item.fileUrl, fileName: item.fileName, content: item.content };
  }
}
