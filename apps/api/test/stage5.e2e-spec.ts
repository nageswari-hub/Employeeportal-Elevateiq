import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('TeamFlow Stage 5 e2e (training + assessments + reports)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const s = Date.now().toString();
  const adminEmail = `s5admin${s}@t.local`;
  const empEmail = `s5emp${s}@t.local`;
  let batchId = '';
  let planId = '';
  let itemId = '';
  let quizId = '';
  let taskBasedId = '';

  const cookies = (res: any): string[] => res.headers['set-cookie'] ?? [];
  const ck = (res: any) => cookies(res).map((x: string) => x.split(';')[0]).join('; ');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.user.create({
      data: { email: adminEmail, passwordHash: await argon2.hash('Admin1234'), displayName: 'A', role: 'ADMIN', mustChangePassword: false },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('training plan -> items -> progress %', async () => {
    const admin = await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password: 'Admin1234' }).expect(200);
    const a = ck(admin);
    const batch = await request(app.getHttpServer()).post('/api/batches').set('Cookie', a)
      .send({ name: `B${s}`, startDate: '2026-01-01', endDate: '2026-03-01', durationDays: 60 }).expect(201);
    batchId = batch.body.id;

    // duplicate plan rejected
    const plan = await request(app.getHttpServer()).post('/api/training-plans').set('Cookie', a)
      .send({ batchId, title: 'Onboarding' }).expect(201);
    planId = plan.body.id;
    await request(app.getHttpServer()).post('/api/training-plans').set('Cookie', a).send({ batchId, title: 'Dup' }).expect(400);

    const i1 = await request(app.getHttpServer()).post(`/api/training-plans/${planId}/items`).set('Cookie', a)
      .send({ dayNumber: 1, topic: 'Git basics' }).expect(201);
    await request(app.getHttpServer()).post(`/api/training-plans/${planId}/items`).set('Cookie', a)
      .send({ dayNumber: 2, topic: 'API basics' }).expect(201);
    itemId = i1.body.id;
    // duplicate day rejected
    await request(app.getHttpServer()).post(`/api/training-plans/${planId}/items`).set('Cookie', a)
      .send({ dayNumber: 1, topic: 'Dup day' }).expect(400);

    await request(app.getHttpServer()).post(`/api/training-items/${itemId}/materials`).set('Cookie', a)
      .send({ kind: 'LINK', title: 'Git docs', url: 'https://git-scm.com/doc' }).expect(201);

    // trainee marks 1/2 -> 50%
    await prisma.user.create({
      data: { email: empEmail, passwordHash: await argon2.hash('Emp12345'), displayName: 'E', role: 'EMPLOYEE', batchId, mustChangePassword: false },
    });
    const emp = await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp12345' }).expect(200);
    const e = ck(emp);
    await request(app.getHttpServer()).post(`/api/training-items/${itemId}/progress`).set('Cookie', e).send({ isDone: true }).expect(201);
    const got = await request(app.getHttpServer()).get(`/api/training-plans/${planId}`).set('Cookie', e).expect(200);
    expect(got.body.myPct).toBe(50);

    // employee cannot create plan
    await request(app.getHttpServer()).post('/api/training-plans').set('Cookie', e).send({ batchId, title: 'No' }).expect(403);
  });

  it('MCQ auto-graded, multi-attempt best kept; task-based lead-graded', async () => {
    const admin = await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password: 'Admin1234' }).expect(200);
    const a = ck(admin);
    const emp = await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp12345' }).expect(200);
    const e = ck(emp);

    const quiz = await request(app.getHttpServer()).post('/api/assessments').set('Cookie', a)
      .send({ batchId, title: 'Week 1 quiz', type: 'QUIZ' }).expect(201);
    quizId = quiz.body.id;
    await request(app.getHttpServer()).post(`/api/assessments/${quizId}/questions`).set('Cookie', a)
      .send({ prompt: '2+2?', options: ['3', '4', '5'], correctIndex: 1, points: 2 }).expect(201);
    await request(app.getHttpServer()).post(`/api/assessments/${quizId}/questions`).set('Cookie', a)
      .send({ prompt: 'Capital of TN?', options: ['Chennai', 'Madurai'], correctIndex: 0, points: 3 }).expect(201);

    // answer key hidden from trainee
    const q = await request(app.getHttpServer()).get(`/api/assessments/${quizId}`).set('Cookie', e).expect(200);
    expect(q.body.questions[0].correctIndex).toBeNull();

    // attempt 1: 1/2 right -> 2 pts; attempt 2: all right -> 5 pts; best = 5
    const t1 = await request(app.getHttpServer()).post(`/api/assessments/${quizId}/attempts`).set('Cookie', e).send({ answers: [1, 1] }).expect(201);
    expect(Number(t1.body.score)).toBe(2);
    expect(t1.body.isGraded).toBe(true);
    const t2 = await request(app.getHttpServer()).post(`/api/assessments/${quizId}/attempts`).set('Cookie', e).send({ answers: [1, 0] }).expect(201);
    expect(Number(t2.body.score)).toBe(5);
    const mine = await request(app.getHttpServer()).get(`/api/assessments/${quizId}/my-attempts`).set('Cookie', e).expect(200);
    expect(mine.body.count).toBe(2);
    expect(Number(mine.body.best.score)).toBe(5);

    // task-based: ungraded until lead grades
    const tb = await request(app.getHttpServer()).post('/api/assessments').set('Cookie', a)
      .send({ batchId, title: 'Build CRUD', type: 'TASK_BASED' }).expect(201);
    taskBasedId = tb.body.id;
    const sub = await request(app.getHttpServer()).post(`/api/assessments/${taskBasedId}/attempts`).set('Cookie', e).send({ answers: ['done: repo link'] }).expect(201);
    expect(sub.body.isGraded).toBe(false);
    const graded = await request(app.getHttpServer()).post(`/api/assessment-attempts/${sub.body.id}/grade`).set('Cookie', a)
      .send({ score: 85, remarks: 'Good work' }).expect(201);
    expect(Number(graded.body.score)).toBe(85);
    // trainee cannot grade
    await request(app.getHttpServer()).post(`/api/assessment-attempts/${sub.body.id}/grade`).set('Cookie', e).send({ score: 100 }).expect(403);
  });

  it('daily reports: submit, edit, late, status/missing', async () => {
    const admin = await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password: 'Admin1234' }).expect(200);
    const a = ck(admin);
    const emp = await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp12345' }).expect(200);
    const e = ck(emp);

    const r1 = await request(app.getHttpServer()).post('/api/daily-reports').set('Cookie', e)
      .send({ didToday: 'Did X', planTomorrow: 'Do Y', hoursWorked: 7 }).expect(201);
    expect(r1.body.isLate).toBeDefined();

    // same-day edit updates (upsert, no duplicate)
    const r2 = await request(app.getHttpServer()).post('/api/daily-reports').set('Cookie', e)
      .send({ didToday: 'Did X edited', planTomorrow: 'Do Y', hoursWorked: 8 }).expect(201);
    expect(r2.body.id).toBe(r1.body.id);

    // hours > 24 rejected
    await request(app.getHttpServer()).post('/api/daily-reports').set('Cookie', e)
      .send({ didToday: 'x', planTomorrow: 'y', hoursWorked: 25 }).expect(400);

    // backfilled past date is late
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const past = await request(app.getHttpServer()).post('/api/daily-reports').set('Cookie', e)
      .send({ reportDate: twoDaysAgo, didToday: 'Backfill', planTomorrow: 'More', hoursWorked: 6 }).expect(201);
    expect(past.body.isLate).toBe(true);
    // v2 rule: backfill is limited to the last 14 days
    await request(app.getHttpServer()).post('/api/daily-reports').set('Cookie', e)
      .send({ reportDate: '2026-01-05', didToday: 'Too old', planTomorrow: 'x', hoursWorked: 6 }).expect(400);

    // status shows submitted vs missing
    const st = await request(app.getHttpServer()).get('/api/daily-reports/status').set('Cookie', a).expect(200);
    expect(st.body.submitted.length).toBeGreaterThanOrEqual(1);

    // evaluation upsert + readiness
    const empRow = await prisma.user.findUnique({ where: { email: empEmail } });
    const ev = await request(app.getHttpServer()).put('/api/batch-evaluations').set('Cookie', a)
      .send({ batchId, userId: empRow!.id, readiness: 'DEVELOPING', remarks: 'Improving', attendancePct: 90, taskCompletionPct: 70, avgScore: 80 }).expect(200);
    expect(ev.body.readiness).toBe('DEVELOPING');
  });
});
