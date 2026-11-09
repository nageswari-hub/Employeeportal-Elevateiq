import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { LearningService } from './learning.service';
import {
  CreateAssessmentDto,
  CreateItemDto,
  CreateMaterialDto,
  CreatePlanDto,
  CreateQuestionDto,
  GradeAttemptDto,
  SetProgressDto,
  SubmitAttemptDto,
  UpdateItemDto,
  UpdatePlanDto,
} from './dto/learning.dto';

@Controller()
export class LearningController {
  constructor(private learning: LearningService) {}

  private ip(req: Request) {
    return req.ip;
  }

  // ----- plans/items/materials/progress -----
  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('training-plans')
  createPlan(@CurrentUser() me: RequestUser, @Body() dto: CreatePlanDto, @Req() req: Request) {
    return this.learning.createPlan(me, dto, this.ip(req));
  }

  @Get('training-plans')
  plans(@CurrentUser() me: RequestUser, @Query('batchId') batchId?: string) {
    return this.learning.listPlans(me, batchId);
  }

  @Get('training-plans/:id')
  plan(@Param('id') id: string, @CurrentUser() me: RequestUser) {
    return this.learning.getPlan(id, me);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Patch('training-plans/:id')
  updatePlan(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdatePlanDto, @Req() req: Request) {
    return this.learning.updatePlan(me, id, dto, this.ip(req));
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('training-plans/:id/items')
  addItem(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: CreateItemDto, @Req() req: Request) {
    return this.learning.addItem(me, id, dto, this.ip(req));
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Patch('training-items/:id')
  updateItem(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.learning.updateItem(me, id, dto);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Delete('training-items/:id')
  deleteItem(@CurrentUser() me: RequestUser, @Param('id') id: string, @Req() req: Request) {
    return this.learning.deleteItem(me, id, this.ip(req));
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('training-items/:id/materials')
  addMaterial(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: CreateMaterialDto) {
    return this.learning.addMaterial(me, id, dto);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Delete('training-materials/:id')
  deleteMaterial(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.learning.deleteMaterial(me, id);
  }

  @Post('training-items/:id/progress')
  progress(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: SetProgressDto) {
    return this.learning.setProgress(me, id, dto.isDone ?? true);
  }

  @Roles('ADMIN', 'TEAM_LEAD', 'COORDINATOR')
  @Get('training-plans/:id/batch-progress')
  batchProgress(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.learning.batchProgress(me, id);
  }

  // ----- assessments -----
  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('assessments')
  createAssessment(@CurrentUser() me: RequestUser, @Body() dto: CreateAssessmentDto, @Req() req: Request) {
    return this.learning.createAssessment(me, dto, this.ip(req));
  }

  @Get('assessments')
  assessments(@CurrentUser() me: RequestUser, @Query('batchId') batchId?: string) {
    return this.learning.listAssessments(me, batchId);
  }

  @Get('assessments/:id')
  assessment(@Param('id') id: string, @CurrentUser() me: RequestUser) {
    return this.learning.getAssessment(id, me);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('assessments/:id/questions')
  addQuestion(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: CreateQuestionDto) {
    return this.learning.addQuestion(me, id, dto);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Delete('assessment-questions/:id')
  deleteQuestion(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.learning.deleteQuestion(me, id);
  }

  @Post('assessments/:id/attempts')
  submit(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: SubmitAttemptDto, @Req() req: Request) {
    return this.learning.submit(me, id, dto, this.ip(req));
  }

  @Get('assessments/:id/my-attempts')
  mine(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.learning.myAttempts(me, id);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Get('assessments/:id/attempts')
  all(@CurrentUser() me: RequestUser, @Param('id') id: string) {
    return this.learning.allAttempts(me, id);
  }

  @Roles('ADMIN', 'TEAM_LEAD')
  @Post('assessment-attempts/:id/grade')
  grade(@CurrentUser() me: RequestUser, @Param('id') id: string, @Body() dto: GradeAttemptDto, @Req() req: Request) {
    return this.learning.grade(me, id, dto, this.ip(req));
  }
}
