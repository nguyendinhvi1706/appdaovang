import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMt5AccountDto } from './mt5-accounts.dto';

@Injectable()
export class Mt5AccountsService {
  constructor(private prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.mt5Account.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateMt5AccountDto) {
    if (dto.isDefault) {
      await this.prisma.mt5Account.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return this.prisma.mt5Account.create({ data: { ...dto, userId } });
  }

  async update(userId: string, id: string, dto: Partial<CreateMt5AccountDto>) {
    await this.ensureOwner(userId, id);
    if (dto.isDefault) {
      await this.prisma.mt5Account.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return this.prisma.mt5Account.update({ where: { id }, data: dto });
  }

  async remove(userId: string, id: string) {
    await this.ensureOwner(userId, id);
    return this.prisma.mt5Account.delete({ where: { id } });
  }

  private async ensureOwner(userId: string, id: string) {
    const acc = await this.prisma.mt5Account.findFirst({ where: { id, userId } });
    if (!acc) throw new NotFoundException('Không tìm thấy tài khoản');
  }
}
