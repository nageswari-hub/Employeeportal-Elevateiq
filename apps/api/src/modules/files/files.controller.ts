import { Controller, Delete, Get, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { FilesService } from './files.service';

@Controller()
export class FilesController {
  constructor(private files: FilesService) {}

  /**
   * Raw-body upload: the browser sends the file bytes as application/octet-stream and everything else in the query string.
   * No multipart parsing means no buffering in memory, real progress events, and any file type.
   */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('files')
  upload(@CurrentUser() me: RequestUser, @Req() req: Request, @Query() q: { context?: string; scopeId?: string; name?: string; w?: string; h?: string }) {
    return this.files.upload(me, req, q);
  }

  @Get('files/:id')
  download(@CurrentUser() me: RequestUser, @Param('id') id: string, @Query('inline') inline: string | undefined, @Res() res: Response) {
    return this.files.serve(me, id, inline === '1', res);
  }

  @Delete('files/:id')
  remove(@CurrentUser() me: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.files.remove(me, id, req.ip);
  }

  // ----- profile photos -----
  @Get('avatars')
  map() {
    return this.files.avatarMap();
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Put('avatars/me')
  setMine(@CurrentUser() me: RequestUser, @Req() req: Request) {
    return this.files.setAvatar(me, req);
  }

  @Get('avatars/:userId')
  avatar(@Param('userId') userId: string, @Query('v') v: string | undefined, @Res() res: Response) {
    return this.files.serveAvatar(userId, v, res);
  }

  @Delete('avatars/:userId')
  removeAvatar(@CurrentUser() me: RequestUser, @Param('userId') userId: string, @Req() req: Request) {
    return this.files.removeAvatar(me, userId === 'me' ? me.id : userId, req.ip);
  }
}
