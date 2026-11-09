import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WorkCalendarService } from './work-calendar.service';
import { dayStr, dayToDate } from './time';

/**
 * Daily-report gate: the admin can require that people submit today's daily report
 * before they check out or log out. Default: on for EMPLOYEE, COORDINATOR, TEAM_LEAD.
 * Admins are never blocked (a blocked admin could lock the whole company out of Settings).
 */
@Injectable()
export class ReportGateService {
  constructor(private prisma: PrismaService, private calendar: WorkCalendarService) {}

  private async applies(role: string): Promise<boolean> {
    const gate = await this.calendar.reportGate();
    return gate.enabled && gate.roles.includes(role);
  }

  private hasReportToday(userId: string) {
    return this.prisma.dailyReport.findUnique({
      where: { userId_reportDate: { userId, reportDate: dayToDate(dayStr()) } },
      select: { id: true },
    });
  }

  /** Lightweight status for the UI (attendance chip / attendance page). */
  async status(userId: string, role: string): Promise<{ required: boolean; submitted: boolean }> {
    if (!(await this.applies(role))) return { required: false, submitted: true };
    return { required: true, submitted: Boolean(await this.hasReportToday(userId)) };
  }

  /**
   * Throws BadRequestException({ code: 'REPORT_REQUIRED' }) when the person must report first.
   * Logout is only gated while the person is still checked in (an open attendance record);
   * check-out is always gated when the report is missing.
   */
  async assert(userId: string, role: string, action: 'CHECK_OUT' | 'LOG_OUT') {
    if (!(await this.applies(role))) return;
    if (action === 'LOG_OUT') {
      const rec = await this.prisma.attendanceDay.findUnique({
        where: { userId_day: { userId, day: dayToDate(dayStr()) } },
        select: { checkInAt: true, checkOutAt: true },
      });
      if (!rec?.checkInAt || rec.checkOutAt) return; // not currently working: nothing to block
    }
    if (await this.hasReportToday(userId)) return;
    throw new BadRequestException({
      code: 'REPORT_REQUIRED',
      message: action === 'CHECK_OUT'
        ? "Write today's daily report before checking out — open Reports, submit it, then check out."
        : "You can't log out until you write today's daily report — open Reports, submit it, then log out.",
    });
  }
}
