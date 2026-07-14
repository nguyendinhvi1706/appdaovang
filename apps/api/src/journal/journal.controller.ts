import {
  Body, Controller, Delete, Get, Param, Patch, Post, Request,
  UploadedFiles, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { JournalService } from './journal.service';
import { CreateJournalDto } from './journal.dto';

type UploadedImages = { imageBefore?: Express.Multer.File[]; imageAfter?: Express.Multer.File[] };

const imageFields = FileFieldsInterceptor([
  { name: 'imageBefore', maxCount: 1 },
  { name: 'imageAfter', maxCount: 1 },
]);

function paths(files?: UploadedImages) {
  return {
    before: files?.imageBefore?.[0] ? `/uploads/${files.imageBefore[0].filename}` : undefined,
    after: files?.imageAfter?.[0] ? `/uploads/${files.imageAfter[0].filename}` : undefined,
  };
}

@UseGuards(JwtAuthGuard)
@Controller('journal')
export class JournalController {
  constructor(private svc: JournalService) {}

  @Get()
  list(@Request() req: any) {
    return this.svc.list(req.user.id);
  }

  @Get('stats')
  stats(@Request() req: any) {
    return this.svc.stats(req.user.id);
  }

  @Post()
  @UseInterceptors(imageFields)
  create(@Request() req: any, @Body() dto: CreateJournalDto, @UploadedFiles() files: UploadedImages) {
    return this.svc.create(req.user.id, dto, paths(files));
  }

  @Patch(':id')
  @UseInterceptors(imageFields)
  update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateJournalDto>,
    @UploadedFiles() files: UploadedImages,
  ) {
    return this.svc.update(req.user.id, id, dto, paths(files));
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    return this.svc.remove(req.user.id, id);
  }
}
