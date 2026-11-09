import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';
import { SubmitReportDto, UpsertEvaluationDto } from '../learning/dto/learning.dto';

@Controller()
export class ReportsController {
  constructor(private reports: ReportsService) {}

  private ip(req: Request) {
    return req.ip;
  }

  @Post('daily-reports')
  submit(@CurrentUser() me: RequestUser, @Body() dto: SubmitReportDto, @Req() req: Request) {
    return this.reports.submit(me, dto, this.ip(req));
  }

  @Get('daily-reports/mine')
  mine(@CurrentUser() me: RequestUser, @Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.mine(me, from, to);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Get('daily-reports/status')
  status(
    @CurrentUser() me: RequestUser,
    @Query('date') date?: string,
    @Query('teamId') teamId?: string,
    @Query('batchId') batchId?: string,
  ) {
    return this.reports.status(me, date, teamId, batchId);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Get('daily-reports')
  list(@CurrentUser() me: RequestUser, @Query('date') date?: string, @Query('teamId') teamId?: string, @Query('batchId') batchId?: string) {
    return this.reports.list(me, { date, teamId, batchId });
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Put('batch-evaluations')
  evaluate(@CurrentUser() me: RequestUser, @Body() dto: UpsertEvaluationDto, @Req() req: Request) {
    return this.reports.upsertEvaluation(me, dto, this.ip(req));
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('batch-evaluations/compute')
  compute(@CurrentUser() me: RequestUser, @Body() body: { batchId: string }, @Req() req: Request) {
    return this.reports.computeEvaluations(me, String(body?.batchId ?? ''), this.ip(req));
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Get('batch-evaluations')
  evaluations(@CurrentUser() me: RequestUser, @Query('batchId') batchId: string) {
    return this.reports.listEvaluations(me, batchId);
  }

  @Get('settings')
  settings() {
    return this.reports.listSettings();
  }

  @Roles('ADMIN')
  @Put('settings/:key')
  setting(@CurrentUser() me: RequestUser, @Param('key') key: string, @Body() body: { value: unknown }, @Req() req: Request) {
    return this.reports.putSetting(me, key, body?.value, this.ip(req));
  }
}
