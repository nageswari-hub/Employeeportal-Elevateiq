import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { contentDisposition } from '../files/file-types';
import { AttendanceService } from './attendance.service';
import { CheckInDto, CheckOutDto, MarkAttendanceDto, StartBreakDto } from './attendance.dto';

@Controller('attendance')
export class AttendanceController {
  constructor(private att: AttendanceService) {}

  @Get('today')
  today(@CurrentUser() me: RequestUser) {
    return this.att.today(me);
  }

  @Post('check-in')
  checkIn(@CurrentUser() me: RequestUser, @Body() dto: CheckInDto, @Req() req: Request) {
    return this.att.checkIn(me, dto, req.ip);
  }

  @Post('check-out')
  checkOut(@CurrentUser() me: RequestUser, @Body() dto: CheckOutDto) {
    return this.att.checkOut(me, dto);
  }

  @Post('break/start')
  startBreak(@CurrentUser() me: RequestUser, @Body() dto: StartBreakDto) {
    return this.att.startBreak(me, dto);
  }

  @Post('break/end')
  endBreak(@CurrentUser() me: RequestUser) {
    return this.att.endBreak(me);
  }

  @Get('mine')
  mine(@CurrentUser() me: RequestUser, @Query('month') month?: string) {
    return this.att.mine(me, { month });
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Get('board')
  board(@CurrentUser() me: RequestUser, @Query('date') date?: string, @Query('teamId') teamId?: string, @Query('batchId') batchId?: string) {
    return this.att.board(me, { date, teamId, batchId });
  }

  @Get('person/:userId')
  person(@CurrentUser() me: RequestUser, @Param('userId') userId: string, @Query('month') month?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.att.person(me, userId, { month, from, to });
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('mark')
  mark(@CurrentUser() me: RequestUser, @Body() dto: MarkAttendanceDto, @Req() req: Request) {
    return this.att.mark(me, dto, req.ip);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get('export')
  async export(
    @CurrentUser() me: RequestUser, @Res() res: Response,
    @Query() q: { type?: string; date?: string; month?: string; from?: string; to?: string; userId?: string; teamId?: string; batchId?: string; format?: string },
  ) {
    const f = await this.att.export(me, q);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', contentDisposition('attachment', f.filename));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(f.body.length));
    res.end(f.body);
  }
}
