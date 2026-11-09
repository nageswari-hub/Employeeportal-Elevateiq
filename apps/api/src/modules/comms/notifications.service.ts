import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { RealtimeGateway } from './realtime.gateway';
import { MailService } from '../../common/mail.service';

/** High-signal events also go out by email when SMTP is configured. */
const EMAIL_TYPES = new Set(['TASK_ASSIGNED', 'REVIEW_REQUESTED', 'REVIEW_DECISION', 'TICKET', 'PASSWORD_RESET_REQUEST']);

export interface NotifyInput {
  type:
    | 'TASK_ASSIGNED' | 'TASK_STATUS_CHANGED' | 'TASK_BLOCKED' | 'REVIEW_REQUESTED' | 'REVIEW_DECISION'
    | 'REPORT_MISSING' | 'REPORT_REMINDER' | 'ANNOUNCEMENT' | 'ASSESSMENT_ASSIGNED' | 'ASSESSMENT_GRADED'
    | 'MENTION' | 'PASSWORD_RESET_REQUEST' | 'TASK_COMMENT' | 'ATTENTION' | 'ATTENDANCE' | 'SYSTEM'
    | 'MEETING_REMINDER' | 'TICKET';
  title: string;
  body?: string;
  link?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService, private realtime: RealtimeGateway, private mail: MailService) {}

  /** Saves notifications AND pushes them live in one step (callers no longer emit separately). */
  async notify(userIds: string[], n: NotifyInput): Promise<Array<{ userId: string }>> {
    const uniq = [...new Set(userIds)].filter(Boolean).slice(0, 1000);
    if (!uniq.length) return [];
    await this.prisma.notification.createMany({
      data: uniq.map((userId) => ({
        userId,
        type: n.type as any,
        title: n.title.slice(0, 200),
        body: n.body?.slice(0, 5000) ?? null,
        link: n.link?.slice(0, 500) ?? null,
      })),
    });
    this.realtime.emitToUsers(uniq, { type: n.type, title: n.title.slice(0, 200), link: n.link });
    if (this.mail.enabled && EMAIL_TYPES.has(n.type)) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: uniq }, isActive: true }, select: { email: true },
      });
      for (const u of users) void this.mail.send(u.email, n.title, n.body ?? '', n.link);
    }
    return uniq.map((userId) => ({ userId }));
  }

  async list(me: RequestUser, q: { unread?: string; page?: string; limit?: string }) {
    const page = Math.max(1, Number(q.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
    const where: any = { userId: me.id };
    if (q.unread === 'true') where.isRead = false;
    const [data, unread] = await Promise.all([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.notification.count({ where: { userId: me.id, isRead: false } }),
    ]);
    return { data, unread };
  }

  async markRead(me: RequestUser, id: string) {
    await this.prisma.notification.updateMany({ where: { id, userId: me.id }, data: { isRead: true } });
    return { ok: true };
  }

  async markAllRead(me: RequestUser) {
    await this.prisma.notification.updateMany({ where: { userId: me.id, isRead: false }, data: { isRead: true } });
    return { ok: true };
  }
}
