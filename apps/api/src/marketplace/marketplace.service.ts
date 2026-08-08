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

  /**
   * Nạp sẵn các EA mẫu vào Marketplace.
   *
   * File trỏ thẳng vào GitHub (raw) thay vì upload lên server, vì đĩa của Render free tier là ĐĨA
   * TẠM — mọi file upload sẽ MẤT mỗi lần deploy lại. Trỏ vào GitHub thì file bền vĩnh viễn, miễn
   * phí, và ai cũng đọc được mã nguồn trước khi tải (đúng tinh thần mã nguồn mở của dự án).
   *
   * Chạy lại nhiều lần cũng an toàn: đã có sản phẩm cùng tiêu đề thì bỏ qua.
   */
  async seedSamples(userId: string) {
    const RAW = 'https://raw.githubusercontent.com/nguyendinhvi1706/appdaovang/main/marketplace-assets';

    const samples: Array<{
      category: MarketCategoryVal; title: string; description: string; content: string;
      fileName: string;
    }> = [
      {
        category: 'EA' as MarketCategoryVal,
        title: 'Setup A+ (SMC) — Sweep → CHOCH → OB + FVG',
        description: 'EA triển khai đúng chuỗi Setup A+: quét thanh khoản, phá cấu trúc, vào lệnh tại vùng Order Block hợp lưu FVG. Chưa kiểm chứng lợi thế — để bạn tự backtest.',
        fileName: 'AppDaoVang_SetupAPlus.mq5',
        content: [
          'LOGIC VÀO LỆNH (10 bước):',
          '1. Xu hướng H4 phải rõ: HH+HL (chỉ Buy) hoặc LL+LH (chỉ Sell)',
          '2. Gom vùng thanh khoản: PDH/PDL + swing high/low gần đây',
          '3. Chờ Liquidity Sweep — nến thủng mốc rồi ĐÓNG CỬA trở lại bên trong',
          '4. Bắt buộc có CHOCH — phá swing ngược chiều gần nhất. Chưa phá thì cú quét chỉ là nhiễu',
          '5. Order Block = nến ngược chiều CUỐI CÙNG trước cú đẩy phá cấu trúc',
          '6. FVG sinh ra trong cú đẩy, chưa bị lấp',
          '7. OB và FVG phải LIỀN KỀ (≤0.5×ATR) — lưu ý FVG nằm trên thân OB chứ không đè lên',
          '8. Đặt lệnh chờ tại rìa OB, huỷ nếu quá 96 nến chưa khớp',
          '9. SL ngoài đáy/đỉnh CÚ QUÉT (không đặt sát OB), tối thiểu 1.5×ATR',
          '10. TP tại thanh khoản đối diện, RR 1:1.5–1:8. Không có mục tiêu hợp lý thì KHÔNG vào lệnh',
          '',
          'QUẢN LÝ VỐN: tự tính lot theo % rủi ro, dừng khi lỗ quá X%/ngày, giới hạn số lệnh/ngày.',
          '',
          '⚠️ CHƯA ĐƯỢC KIỂM CHỨNG có lợi thế. Hãy chạy Strategy Tester nhiều năm trên chính broker bạn dùng.',
        ].join('\n'),
      },
      {
        category: 'EA' as MarketCategoryVal,
        title: 'Breakout Buy Stop / Sell Stop (OCO)',
        description: 'Phá vỡ biên độ Donchian hoặc biên độ phiên Á. Đặt hai lệnh chờ hai đầu, bên nào khớp thì huỷ bên kia. Có hoà vốn tại 1R và trailing ATR.',
        fileName: 'AppDaoVang_Breakout.mq5',
        content: [
          'CÁCH HOẠT ĐỘNG:',
          '- Đo biên độ theo Donchian N nến, hoặc biên độ phiên Á (00:00-07:00 UTC)',
          '- Đặt Buy Stop trên đỉnh + đệm ATR, Sell Stop dưới đáy - đệm ATR',
          '- Bên nào khớp trước thì tự huỷ bên còn lại (OCO)',
          '- SL theo ATR, TP theo tỷ lệ RR đặt trước',
          '- Huỷ lệnh chờ nếu quá N nến chưa khớp',
          '',
          'QUẢN LÝ LỆNH: dời SL về hoà vốn khi đạt 1R, trailing stop theo ATR, giới hạn 1 lệnh/ngày.',
          '',
          'GHI CHÚ: đây thuộc họ theo đà (momentum) — nhóm có bằng chứng học thuật tương đối vững nhất',
          'trong phân tích kỹ thuật. Nhưng lợi thế nếu có thường NHỎ và cần nhiều năm mới thể hiện.',
          '',
          '⚠️ CHƯA ĐƯỢC KIỂM CHỨNG trên dữ liệu của bạn. Tự backtest trước.',
        ].join('\n'),
      },
      {
        category: 'EA' as MarketCategoryVal,
        title: 'DCA / Grid có PHANH CỨNG (đọc cảnh báo)',
        description: '⚠️ DCA nhân hệ số cho winrate rất cao nhưng đổi lấy rủi ro thảm hoạ. Bản này BẮT BUỘC cắt lỗ toàn rổ, giới hạn tầng, dừng theo ngày. Đọc kỹ phần cảnh báo toán học.',
        fileName: 'AppDaoVang_DCA_Grid.mq5',
        content: [
          '⚠️ CẢNH BÁO TOÁN HỌC — ĐỌC TRƯỚC KHI CHẠY',
          '',
          'DCA nhân hệ số cho tỷ lệ thắng RẤT CAO và đường vốn rất đẹp. Đó KHÔNG phải bằng chứng nó tốt.',
          'Đó là bản chất của việc đổi xác suất thắng cao lấy RỦI RO THẢM HOẠ hiếm gặp.',
          '',
          'Với hệ số 1.3 và 6 tầng, tổng khối lượng khi đủ tầng gấp ~6.7 lần tầng đầu. Một xu hướng kéo',
          'dài không hồi sẽ chạm hết các tầng rồi tiếp tục đi — mất mát ở tầng cuối lớn gấp nhiều lần',
          'toàn bộ lợi nhuận tích luỹ trước đó.',
          '',
          'Nói cách khác: TỶ LỆ THẮNG 95% VẪN CÓ THỂ LỖ, nếu 5% còn lại xoá sạch lãi của 95%.',
          'Khi đánh giá, ĐỪNG nhìn Win Rate — nhìn Max Drawdown, Profit Factor, và điều gì xảy ra',
          'trong giai đoạn thị trường có xu hướng mạnh nhất của dữ liệu test.',
          '',
          'PHANH CỨNG ĐÃ TÍCH HỢP:',
          '- Cắt lỗ TOÀN RỔ khi lỗ quá 10% vốn (mặc định bật)',
          '- Tối đa 6 tầng, không có chế độ nhân vô hạn',
          '- Dừng mở rổ mới khi lỗ quá 5% trong ngày',
          '- Kiểm tra ký quỹ tự do trước khi thêm tầng',
          '- Bỏ qua khi spread giãn rộng',
          '- Lọc RSI để không mở rổ ngược giữa cú chạy mạnh',
          '',
          'Nếu tắt cắt lỗ toàn rổ, EA sẽ in cảnh báo vào log — đó là cấu hình có thể mất TOÀN BỘ vốn,',
          'và cũng là cấu hình mà phần lớn "EA DCA thần thánh" bán trên mạng dùng để tạo backtest đẹp.',
        ].join('\n'),
      },
    ];

    let created = 0, skipped = 0;
    for (const s of samples) {
      const exists = await this.prisma.marketItem.findFirst({ where: { title: s.title } });
      if (exists) { skipped++; continue; }
      await this.prisma.marketItem.create({
        data: {
          authorId: userId,
          category: s.category as any,
          title: s.title,
          description: s.description,
          content: s.content,
          fileUrl: `${RAW}/${s.fileName}`,
          fileName: s.fileName,
          version: '1.0',
        },
      });
      created++;
    }
    return { created, skipped };
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
