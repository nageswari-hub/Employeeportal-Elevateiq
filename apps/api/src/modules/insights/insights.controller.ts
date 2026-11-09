import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { InsightsService } from './insights.service';
import { ExportsService } from './exports.service';

@Controller()
export class InsightsController {
  constructor(private insights: InsightsService, private exports: ExportsService) {}

  @Roles('ADMIN')
  @Get('dashboard/admin')
  admin() {
    return this.insights.adminOverview();
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Get('dashboard/lead')
  lead(@CurrentUser() me: RequestUser, @Query('teamId') teamId?: string) {
    return this.insights.leadOverview(me, teamId);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Get('dashboard/coordinator')
  coordinator(@CurrentUser() me: RequestUser, @Query('teamId') teamId?: string) {
    return this.insights.coordinatorToday(me, teamId);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Get('dashboard/attention')
  attention(@CurrentUser() me: RequestUser, @Query('teamId') teamId?: string) {
    return this.insights.attention(me, teamId);
  }

  @Get('dashboard/me')
  me(@CurrentUser() me: RequestUser) {
    return this.insights.mySummary(me);
  }

  @Get('exports/tasks.csv')
  async tasksCsv(
    @CurrentUser() me: RequestUser,
    @Query('teamId') teamId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const out = await this.exports.tasksCsv(me, { teamId: teamId || undefined, status: status || undefined, from: from || undefined, to: to || undefined });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }

  @Get('exports/tasks.pdf')
  async tasksPdf(
    @CurrentUser() me: RequestUser,
    @Query('teamId') teamId: string | undefined,
    @Query('status') status: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const out = await this.exports.tasksPdf(me, { teamId: teamId || undefined, status: status || undefined, from: from || undefined, to: to || undefined });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }

  @Get('exports/reports.csv')
  async reportsCsv(
    @CurrentUser() me: RequestUser,
    @Query('date') date: string | undefined,
    @Query('teamId') teamId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('period') period: string | undefined,
    @Res() res: Response,
  ) {
    const out = await this.exports.reportsCsv(me, { date: date || undefined, teamId: teamId || undefined, from: from || undefined, to: to || undefined, userId: userId || undefined, period: period || undefined });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }

  @Get('exports/reports.pdf')
  async reportsPdf(
    @CurrentUser() me: RequestUser,
    @Query('date') date: string | undefined,
    @Query('teamId') teamId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('period') period: string | undefined,
    @Res() res: Response,
  ) {
    const out = await this.exports.reportsPdf(me, { date: date || undefined, teamId: teamId || undefined, from: from || undefined, to: to || undefined, userId: userId || undefined, period: period || undefined });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
    res.send(out.body);
  }
}
