import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PublishDto, SharedTypeVal } from './shared.dto';

@Injectable()
export class SharedService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string, type?: SharedTypeVal, q?: string) {
    const items = await this.prisma.sharedItem.findMany({
      where: {
        ...(type && { type }),
        ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }),
      },
      include: {
        author: { select: { id: true, name: true } },
        likes: { select: { userId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return items.map((i) => ({
      id: i.id, type: i.type, title: i.title, description: i.description,
      content: i.content, downloads: i.downloads, createdAt: i.createdAt,
      author: i.author.name ?? 'Ẩn danh',
      isMine: i.authorId === userId,
      likeCount: i.likes.length,
      likedByMe: i.likes.some((l) => l.userId === userId),
    }));
  }

  publish(userId: string, dto: PublishDto) {
    return this.prisma.sharedItem.create({ data: { ...dto, authorId: userId } });
  }

  async remove(userId: string, id: string) {
    const item = await this.prisma.sharedItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException();
    if (item.authorId !== userId) throw new ForbiddenException('Chỉ tác giả mới xóa được');
    return this.prisma.sharedItem.delete({ where: { id } });
  }

  async toggleLike(userId: string, itemId: string) {
    const existing = await this.prisma.sharedLike.findUnique({
      where: { userId_itemId: { userId, itemId } },
    });
    if (existing) {
      await this.prisma.sharedLike.delete({ where: { id: existing.id } });
      return { liked: false };
    }
    await this.prisma.sharedLike.create({ data: { userId, itemId } });
    return { liked: true };
  }

  /** "Dùng" một item: tăng lượt tải và trả về content */
  async use(id: string) {
    const item = await this.prisma.sharedItem.update({
      where: { id },
      data: { downloads: { increment: 1 } },
    });
    return { content: item.content, type: item.type, title: item.title };
  }
}
