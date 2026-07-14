import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Query,
  Request, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MarketplaceService } from './marketplace.service';
import { CreateItemDto, MARKET_CATEGORIES, MarketCategoryVal } from './marketplace.dto';

const ALLOWED_EXT = ['.mq4', '.mq5', '.ex4', '.ex5', '.zip', '.txt', '.json', '.pine', '.py', '.csv', '.set', '.tpl'];

const fileUpload = FileInterceptor('file', {
  storage: diskStorage({
    destination: './uploads',
    filename: (_req, file, cb) =>
      cb(null, `mkt-${Date.now()}-${Math.round(Math.random() * 1e9)}${extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ALLOWED_EXT.includes(extname(file.originalname).toLowerCase());
    cb(ok ? null : new BadRequestException(`Chỉ chấp nhận file: ${ALLOWED_EXT.join(', ')}`), ok);
  },
});

@UseGuards(JwtAuthGuard)
@Controller('marketplace')
export class MarketplaceController {
  constructor(private svc: MarketplaceService) {}

  @Get()
  list(@Request() req: any, @Query('category') category?: string, @Query('q') q?: string) {
    const c = MARKET_CATEGORIES.includes(category as MarketCategoryVal) ? (category as MarketCategoryVal) : undefined;
    return this.svc.list(req.user.id, c, q);
  }

  @Post()
  @UseInterceptors(fileUpload)
  create(@Request() req: any, @Body() dto: CreateItemDto, @UploadedFile() file?: Express.Multer.File) {
    return this.svc.create(
      req.user.id,
      dto,
      file ? { url: `/uploads/${file.filename}`, name: file.originalname } : undefined,
    );
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.svc.remove(req.user.id, id);
  }

  @Post(':id/rate')
  rate(@Request() req: any, @Param('id') id: string, @Body('stars') stars: number) {
    return this.svc.rate(req.user.id, id, Number(stars));
  }

  @Post(':id/download')
  download(@Param('id') id: string) {
    return this.svc.download(id);
  }
}
