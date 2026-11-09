import { BadRequestException, Injectable } from '@nestjs/common';
import { FileContext, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What the API exposes about a file (never the storage path or hash). */
export const FILE_SELECT = {
  id: true, name: true, mime: true, size: true, width: true, height: true, createdAt: true, uploaderId: true,
} as const;
export const LIVE_FILES = { where: { deletedAt: null }, select: FILE_SELECT, orderBy: { createdAt: 'asc' as const } };

export const MAX_FILES_PER_ITEM = 10;

@Injectable()
export class FileLinkService {
  constructor(private prisma: PrismaService) {}

  /**
   * Attaches freshly uploaded ("pending") files to the thing they were uploaded for (comment, message, report,
   * announcement). Only the uploader can claim, only once, only for the matching context/scope.
   */
  async claim(
    tx: Prisma.TransactionClient | PrismaService,
    userId: string,
    fileIds: string[] | undefined,
    expect: { context: FileContext; scopeId?: string | null },
    link: Partial<Record<'taskId' | 'commentId' | 'messageId' | 'reportId' | 'announcementId', string>>,
  ): Promise<number> {
    const ids = [...new Set(fileIds ?? [])];
    if (!ids.length) return 0;
    if (ids.length > MAX_FILES_PER_ITEM) throw new BadRequestException(`You can attach up to ${MAX_FILES_PER_ITEM} files at once`);
    const rows = await tx.fileAsset.findMany({ where: { id: { in: ids } } });
    const ok =
      rows.length === ids.length &&
      rows.every(
        (f) =>
          f.uploaderId === userId && !f.deletedAt && f.context === expect.context &&
          !f.taskId && !f.commentId && !f.messageId && !f.reportId && !f.announcementId &&
          (expect.scopeId === undefined || f.scopeId === expect.scopeId),
      );
    if (!ok) throw new BadRequestException('One or more attachments are invalid or were already used. Upload them again.');
    await tx.fileAsset.updateMany({ where: { id: { in: ids } }, data: link });
    return ids.length;
  }
}
