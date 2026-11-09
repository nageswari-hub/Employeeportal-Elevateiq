import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from '../comms/notifications.service';
import {
  CreateAssessmentDto,
  CreateItemDto,
  CreateMaterialDto,
  CreatePlanDto,
  CreateQuestionDto,
  GradeAttemptDto,
  SubmitAttemptDto,
  UpdateItemDto,
  UpdatePlanDto,
} from './dto/learning.dto';

const LEAD_ROLES = ['ADMIN', 'TEAM_LEAD'];
// Deterministic question order everywhere (display AND grading). sortOrder alone can collide after deletes.
const QUESTION_ORDER = [{ sortOrder: 'asc' as const }, { id: 'asc' as const }];
const QUIZ_MAX_ATTEMPTS = Number(process.env.QUIZ_MAX_ATTEMPTS ?? 3);
const OTHER_MAX_ATTEMPTS = 5;

function pct(done: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((done / total) * 1000) / 10;
}

@Injectable()
export class LearningService {
  constructor(private prisma: PrismaService, private audit: AuditService, private notifications: NotificationsService) {}

  /** Interns only see their own batch's material; staff see everything. */
  private batchGuard(me: RequestUser, batchId: string) {
    if (LEAD_ROLES.includes(me.role) || me.role === 'COORDINATOR') return;
    if (!me.batchId || me.batchId !== batchId) throw new ForbiddenException('This belongs to a different batch');
  }

  private scopeBatch(me: RequestUser, batchId?: string): string | undefined {
    if (LEAD_ROLES.includes(me.role) || me.role === 'COORDINATOR') return batchId;
    return me.batchId ?? '__none__';
  }

  private needLead(me: RequestUser) {
    if (!LEAD_ROLES.includes(me.role)) throw new ForbiddenException('Only leads/admins');
  }

  // ---------- Training plans ----------
  async createPlan(me: RequestUser, dto: CreatePlanDto, ip?: string) {
    this.needLead(me);
    const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
    if (!batch) throw new BadRequestException('Invalid batchId');
    const dupe = await this.prisma.trainingPlan.findUnique({ where: { batchId: dto.batchId } });
    if (dupe) throw new BadRequestException('This batch already has a training plan');
    const plan = await this.prisma.trainingPlan.create({
      data: { batchId: dto.batchId, title: dto.title.trim(), description: dto.description ?? null, createdById: me.id },
    });
    await this.audit.log({ actorId: me.id, action: 'TRAINING_PLAN_CREATE', entity: 'training_plan', entityId: plan.id, ip });
    return plan;
  }

  listPlans(me: RequestUser, batchId?: string) {
    const scoped = this.scopeBatch(me, batchId);
    return this.prisma.trainingPlan.findMany({
      where: scoped ? { batchId: scoped } : {},
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { items: true } }, batch: { select: { id: true, name: true } } },
    });
  }

  async getPlan(id: string, me: RequestUser) {
    const plan = await this.prisma.trainingPlan.findUnique({
      where: { id },
      include: {
        items: { orderBy: [{ sortOrder: 'asc' }, { dayNumber: 'asc' }], include: { materials: { orderBy: { sortOrder: 'asc' } } } },
        batch: { select: { id: true, name: true } },
      },
    });
    if (!plan) throw new NotFoundException('Training plan not found');
    this.batchGuard(me, plan.batchId);
    const done = await this.prisma.trainingProgress.count({
      where: { userId: me.id, isDone: true, item: { planId: id } },
    });
    return { ...plan, myDone: done, myTotal: plan.items.length, myPct: pct(done, plan.items.length) };
  }

  async updatePlan(me: RequestUser, id: string, dto: UpdatePlanDto, ip?: string) {
    this.needLead(me);
    await this.mustPlan(id);
    return this.prisma.trainingPlan.update({ where: { id }, data: { ...(dto.title ? { title: dto.title.trim() } : {}), ...(dto.description !== undefined ? { description: dto.description } : {}) } });
  }

  // ---------- Items & materials ----------
  async addItem(me: RequestUser, planId: string, dto: CreateItemDto, ip?: string) {
    this.needLead(me);
    const plan = await this.mustPlan(planId);
    const dupe = await this.prisma.trainingItem.findUnique({ where: { planId_dayNumber: { planId, dayNumber: dto.dayNumber } } }).catch(() => null);
    if (dupe) throw new BadRequestException(`Day ${dto.dayNumber} already exists in this plan`);
    const count = await this.prisma.trainingItem.count({ where: { planId } });
    const item = await this.prisma.trainingItem.create({
      data: { ...dto, topic: dto.topic.trim(), planId, sortOrder: count },
    });
    await this.audit.log({ actorId: me.id, action: 'TRAINING_ITEM_CREATE', entity: 'training_item', entityId: item.id, ip });
    return item;
  }

  async updateItem(me: RequestUser, id: string, dto: UpdateItemDto) {
    this.needLead(me);
    await this.mustItem(id);
    return this.prisma.trainingItem.update({ where: { id }, data: { ...dto } as any });
  }

  async deleteItem(me: RequestUser, id: string, ip?: string) {
    this.needLead(me);
    await this.mustItem(id);
    await this.prisma.trainingItem.delete({ where: { id } });
    await this.audit.log({ actorId: me.id, action: 'TRAINING_ITEM_DELETE', entity: 'training_item', entityId: id, ip });
    return { ok: true };
  }

  async addMaterial(me: RequestUser, itemId: string, dto: CreateMaterialDto) {
    this.needLead(me);
    const item = await this.mustItem(itemId);
    if (!dto.url && !dto.fileKey) throw new BadRequestException('Provide url or fileKey');
    const count = await this.prisma.trainingMaterial.count({ where: { trainingItemId: itemId } });
    return this.prisma.trainingMaterial.create({
      data: { trainingItemId: itemId, kind: (dto.kind ?? 'LINK') as any, title: dto.title.trim(), url: dto.url ?? null, fileKey: dto.fileKey ?? null, sortOrder: count },
    });
  }

  async deleteMaterial(me: RequestUser, id: string) {
    this.needLead(me);
    await this.prisma.trainingMaterial.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Material not found');
    });
    return { ok: true };
  }

  // ---------- Progress (simple %: done/total) ----------
  async setProgress(me: RequestUser, itemId: string, isDone: boolean) {
    const item = await this.prisma.trainingItem.findUnique({ where: { id: itemId }, include: { plan: { select: { batchId: true } } } });
    if (!item) throw new NotFoundException('Training item not found');
    this.batchGuard(me, item.plan.batchId);
    return this.prisma.trainingProgress.upsert({
      where: { userId_trainingItemId: { userId: me.id, trainingItemId: itemId } },
      update: { isDone, completedAt: isDone ? new Date() : null },
      create: { userId: me.id, trainingItemId: itemId, isDone, completedAt: isDone ? new Date() : null },
    });
  }

  async batchProgress(me: RequestUser, planId: string) {
    if (!['ADMIN', 'TEAM_LEAD', 'COORDINATOR'].includes(me.role)) throw new ForbiddenException('Forbidden');
    const plan = await this.mustPlan(planId);
    const [items, members] = await Promise.all([
      this.prisma.trainingItem.findMany({ where: { planId }, select: { id: true } }),
      this.prisma.user.findMany({
        where: { batchId: plan.batchId, isActive: true, ...(me.role === 'COORDINATOR' ? { teamId: me.teamId ?? '__none__' } : {}) },
        select: { id: true, displayName: true, email: true },
        orderBy: { displayName: 'asc' },
      }),
    ]);
    const ids = items.map((i) => i.id);
    const done = ids.length
      ? await this.prisma.trainingProgress.findMany({ where: { trainingItemId: { in: ids }, isDone: true }, select: { userId: true } })
      : [];
    const byUser = new Map<string, number>();
    for (const d of done) byUser.set(d.userId, (byUser.get(d.userId) ?? 0) + 1);
    return {
      total: ids.length,
      trainees: members.map((m) => ({ ...m, done: byUser.get(m.id) ?? 0, progressPct: pct(byUser.get(m.id) ?? 0, ids.length) })),
    };
  }

  // ---------- Assessments ----------
  async createAssessment(me: RequestUser, dto: CreateAssessmentDto, ip?: string) {
    this.needLead(me);
    const batch = await this.prisma.batch.findUnique({ where: { id: dto.batchId } });
    if (!batch) throw new BadRequestException('Invalid batchId');
    const a = await this.prisma.assessment.create({
      data: {
        batchId: dto.batchId, title: dto.title.trim(), description: dto.description ?? null,
        type: (dto.type ?? 'QUIZ') as any, weekNumber: dto.weekNumber ?? null,
        maxScore: dto.maxScore ?? 100, dueDate: dto.dueDate ? new Date(dto.dueDate) : null, createdById: me.id,
      },
    });
    await this.audit.log({ actorId: me.id, action: 'ASSESSMENT_CREATE', entity: 'assessment', entityId: a.id, ip });
    const trainees = await this.prisma.user.findMany({ where: { batchId: dto.batchId, isActive: true, role: 'EMPLOYEE' }, select: { id: true } });
    await this.notifications.notify(trainees.map((t) => t.id), {
      type: 'ASSESSMENT_ASSIGNED', title: `New ${a.type === 'QUIZ' ? 'quiz' : 'assessment'}: ${a.title}`,
      body: a.dueDate ? `Due ${a.dueDate.toISOString().slice(0, 10)}` : undefined, link: `/assessments`,
    });
    return a;
  }

  listAssessments(me: RequestUser, batchId?: string) {
    const scoped = this.scopeBatch(me, batchId);
    return this.prisma.assessment.findMany({
      where: scoped ? { batchId: scoped } : {}, orderBy: { createdAt: 'desc' },
      include: { _count: { select: { questions: true, attempts: true } } },
    });
  }

  async getAssessment(id: string, me: RequestUser) {
    const a = await this.prisma.assessment.findUnique({ where: { id }, include: { questions: { orderBy: QUESTION_ORDER } } });
    if (!a) throw new NotFoundException('Assessment not found');
    this.batchGuard(me, a.batchId);
    const lead = LEAD_ROLES.includes(me.role);
    // Hide answer keys from trainees (quiz integrity)
    return {
      ...a,
      questions: a.questions.map((q) => (lead ? q : { ...q, correctIndex: null })),
    };
  }

  async addQuestion(me: RequestUser, assessmentId: string, dto: CreateQuestionDto) {
    this.needLead(me);
    const a = await this.prisma.assessment.findUnique({ where: { id: assessmentId } });
    if (!a) throw new NotFoundException('Assessment not found');
    const last = await this.prisma.assessmentQuestion.aggregate({ where: { assessmentId }, _max: { sortOrder: true } });
    if (a.type === 'QUIZ') {
      if (!dto.options || dto.options.length < 2) throw new BadRequestException('MCQ needs 2+ options');
      if (dto.correctIndex === undefined || dto.correctIndex < 0 || dto.correctIndex >= dto.options.length)
        throw new BadRequestException('correctIndex out of range');
    }
    return this.prisma.assessmentQuestion.create({
      data: {
        assessmentId, prompt: dto.prompt, options: dto.options ?? undefined,
        correctIndex: dto.correctIndex ?? null, points: dto.points ?? 1, sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
  }

  async deleteQuestion(me: RequestUser, id: string) {
    this.needLead(me);
    await this.prisma.assessmentQuestion.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Question not found');
    });
    return { ok: true };
  }

  // Multi-attempt (capped): every submit creates a new row; best kept (max score).
  async submit(me: RequestUser, assessmentId: string, dto: SubmitAttemptDto, ip?: string) {
    const a = await this.prisma.assessment.findUnique({ where: { id: assessmentId }, include: { questions: { orderBy: QUESTION_ORDER } } });
    if (!a) throw new NotFoundException('Assessment not found');
    const isStaff = LEAD_ROLES.includes(me.role);
    if (!isStaff) {
      this.batchGuard(me, a.batchId);
      if (a.dueDate && a.dueDate.getTime() < Date.now()) throw new BadRequestException('This assessment is past its due date');
      const used = await this.prisma.assessmentAttempt.count({ where: { assessmentId, userId: me.id } });
      const cap = a.type === 'QUIZ' ? QUIZ_MAX_ATTEMPTS : OTHER_MAX_ATTEMPTS;
      if (used >= cap) throw new BadRequestException(`You have used all ${cap} attempts`);
    }
    const answers = dto.answers ?? [];
    let score: number | null = null;
    let graded = false;
    let max = a.maxScore;
    if (a.type === 'QUIZ') {
      max = a.questions.reduce((s, q) => s + q.points, 0) || a.maxScore;
      const byId = dto.questionIds && dto.questionIds.length === answers.length
        ? new Map(dto.questionIds.map((qid, i) => [qid, answers[i]]))
        : null;
      let earned = 0;
      a.questions.forEach((q, i) => {
        const given = byId ? byId.get(q.id) : answers[i];
        if (q.correctIndex !== null && Number(given) === q.correctIndex && given !== null && given !== undefined && given !== '') earned += q.points;
      });
      score = earned;
      graded = true;
    }
    const attempt = await this.prisma.assessmentAttempt.create({
      data: {
        assessmentId, userId: me.id, answers: answers as any,
        score, maxScore: max, isGraded: graded, gradedAt: graded ? new Date() : null,
      },
    });
    await this.audit.log({ actorId: me.id, action: 'ASSESSMENT_SUBMIT', entity: 'assessment_attempt', entityId: attempt.id, ip });
    return attempt;
  }

  async myAttempts(me: RequestUser, assessmentId: string) {
    const rows = await this.prisma.assessmentAttempt.findMany({ where: { assessmentId, userId: me.id }, orderBy: { createdAt: 'desc' } });
    const best = rows.filter((r) => r.score !== null).sort((x, y) => Number(y.score) - Number(x.score))[0] ?? null;
    return { attempts: rows, best, count: rows.length };
  }

  async allAttempts(me: RequestUser, assessmentId: string) {
    this.needLead(me);
    return this.prisma.assessmentAttempt.findMany({
      where: { assessmentId }, orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, displayName: true, email: true } } },
    });
  }

  async grade(me: RequestUser, attemptId: string, dto: GradeAttemptDto, ip?: string) {
    this.needLead(me);
    const at = await this.prisma.assessmentAttempt.findUnique({ where: { id: attemptId } });
    if (!at) throw new NotFoundException('Attempt not found');
    const cap = Number(at.maxScore ?? 0);
    if (cap > 0 && dto.score > cap) throw new BadRequestException(`Score cannot exceed the maximum of ${cap}`);
    const graded = await this.prisma.assessmentAttempt.update({
      where: { id: attemptId },
      data: { score: dto.score, remarks: dto.remarks ?? null, isGraded: true, gradedById: me.id, gradedAt: new Date() },
    });
    await this.audit.log({ actorId: me.id, action: 'ASSESSMENT_GRADE', entity: 'assessment_attempt', entityId: attemptId, metadata: { score: dto.score }, ip });
    await this.notifications.notify([at.userId], {
      type: 'ASSESSMENT_GRADED', title: 'Your assessment was graded', body: `Score ${dto.score}${cap ? ` / ${cap}` : ''}${dto.remarks ? ` — ${dto.remarks}` : ''}`, link: '/assessments',
    });
    return graded;
  }

  private async mustPlan(id: string) {
    const p = await this.prisma.trainingPlan.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Training plan not found');
    return p;
  }

  private async mustItem(id: string) {
    const i = await this.prisma.trainingItem.findUnique({ where: { id } });
    if (!i) throw new NotFoundException('Training item not found');
    return i;
  }
}
