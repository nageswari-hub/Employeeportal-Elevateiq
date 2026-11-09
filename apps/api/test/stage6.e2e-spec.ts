import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('TeamFlow Stage 6 e2e (dashboards + exports)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const s = Date.now().toString();
  const adminEmail = `s6admin${s}@t.local`;
  const leadEmail = `s6lead${s}@t.local`;
  const empEmail = `s6emp${s}@t.local`;
  let teamId = '';

  const ck = (res: any) => (((res.headers as any)['set-cookie'] ?? []) as string[]).map((x) => x.split(';')[0]).join('; ');
  let adminCk = '';
  let leadCk = '';
  let empCk = '';

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
    adminCk = ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password: 'Admin1234' }).expect(200));

    const team = await request(app.getHttpServer()).post('/api/teams').set('Cookie', adminCk).send({ name: `S6T${s}` }).expect(201);
    teamId = team.body.id;

    await request(app.getHttpServer()).post('/api/users').set('Cookie', adminCk)
      .send({ email: leadEmail, password: 'Lead1234x', displayName: 'L', role: 'TEAM_LEAD', teamId }).expect(201);
    await request(app.getHttpServer()).post('/api/users').set('Cookie', adminCk)
      .send({ email: empEmail, password: 'Emp12345x', displayName: 'E', role: 'EMPLOYEE', teamId }).expect(201);

    // lead must change temp password
    const l1 = await request(app.getHttpServer()).post('/api/auth/login').send({ email: leadEmail, password: 'Lead1234x' }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/change-password').set('Cookie', ck(l1)).send({ currentPassword: 'Lead1234x', newPassword: 'Lead5678x' }).expect(200);
    leadCk = ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email: leadEmail, password: 'Lead5678x' }).expect(200));

    const e1 = await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp12345x' }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/change-password').set('Cookie', ck(e1)).send({ currentPassword: 'Emp12345x', newPassword: 'Emp56789x' }).expect(200);
    empCk = ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp56789x' }).expect(200));

    // seed tasks: 1 overdue (past due), 1 blocked, 1 in review
    const emp = await prisma.user.findUnique({ where: { email: empEmail } });
    await prisma.task.create({ data: { title: 'Overdue job', ownerId: emp!.id, teamId, createdById: emp!.id, dueDate: new Date('2020-01-01'), status: 'TODO' } });
    await prisma.task.create({ data: { title: 'Blocked job', ownerId: emp!.id, teamId, createdById: emp!.id, status: 'BLOCKED', blockedReason: 'waiting' } });
    await prisma.task.create({ data: { title: 'Review job', ownerId: emp!.id, teamId, createdById: emp!.id, status: 'IN_REVIEW' } });
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('admin overview shape + overdue/blocked + leaderboard', async () => {
    const r = await request(app.getHttpServer()).get('/api/dashboard/admin').set('Cookie', adminCk).expect(200);
    expect(r.body.tasks.overdue).toBeGreaterThanOrEqual(1);
    expect(r.body.tasks.blocked).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(r.body.leaderboard)).toBe(true);
    expect(r.body.reports.submissionRate).toBeDefined();
  });

  it('lead overview scoped + pending reviews; employee forbidden', async () => {
    const r = await request(app.getHttpServer()).get(`/api/dashboard/lead?teamId=${teamId}`).set('Cookie', leadCk).expect(200);
    expect(r.body.pendingReviews.length).toBeGreaterThanOrEqual(1);
    expect(r.body.members.length).toBeGreaterThanOrEqual(2);
    await request(app.getHttpServer()).get('/api/dashboard/lead').set('Cookie', empCk).expect(403);
    await request(app.getHttpServer()).get('/api/dashboard/admin').set('Cookie', leadCk).expect(403);
  });

  it('coordinator/me endpoints', async () => {
    const c = await request(app.getHttpServer()).get(`/api/dashboard/coordinator?teamId=${teamId}`).set('Cookie', leadCk).expect(200);
    expect(c.body.members.length).toBeGreaterThanOrEqual(2);
    const me = await request(app.getHttpServer()).get('/api/dashboard/me').set('Cookie', empCk).expect(200);
    expect(me.body.tasks.open).toBeGreaterThanOrEqual(3);
    expect(me.body.tasks.overdue).toBeGreaterThanOrEqual(1);
  });

  it('CSV + PDF exports with filters', async () => {
    const csv = await request(app.getHttpServer()).get(`/api/exports/tasks.csv?teamId=${teamId}`).set('Cookie', adminCk).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toMatch(/Title,Status,Priority/);
    expect(csv.text).toMatch(/Overdue job/);

    const blocked = await request(app.getHttpServer()).get('/api/exports/tasks.csv?status=BLOCKED').set('Cookie', adminCk).expect(200);
    expect(blocked.text).toMatch(/Blocked job/);
    expect(blocked.text).not.toMatch(/Overdue job/);

    const pdf = await request(app.getHttpServer()).get(`/api/exports/tasks.pdf?teamId=${teamId}`).set('Cookie', adminCk).expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);

    const rcsv = await request(app.getHttpServer()).get('/api/exports/reports.csv').set('Cookie', adminCk).expect(200);
    expect(rcsv.headers['content-type']).toMatch(/text\/csv/);

    // employee cannot export
    await request(app.getHttpServer()).get('/api/exports/tasks.csv').set('Cookie', empCk).expect(403);
  });
});
