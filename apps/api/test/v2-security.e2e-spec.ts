import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * Regression tests for the v2 hardening. Needs Postgres (same as the other e2e specs):
 *   DATABASE_URL=... JWT_ACCESS_SECRET=... npm run test:e2e
 */
describe('v2 security & access control (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const s = Date.now().toString(36);
  const ck = (r: request.Response) => (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  const login = async (email: string, password: string) =>
    ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email, password }).expect(200));
  let adminCk = '', leadACk = '', empACk = '', coordBCk = '';
  let teamA = '', teamB = '', empA = '', empB = '', taskB = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const hash = await argon2.hash('Passw0rd1');
    const mk = (email: string, role: any, teamId: string | null = null) =>
      prisma.user.create({ data: { email: `${email}-${s}@t.local`, passwordHash: hash, displayName: email, role, teamId, mustChangePassword: false } });
    await mk('admin', 'ADMIN');
    adminCk = await login(`admin-${s}@t.local`, 'Passw0rd1');
    teamA = (await request(app.getHttpServer()).post('/api/teams').set('Cookie', adminCk).send({ name: `A-${s}` }).expect(201)).body.id;
    teamB = (await request(app.getHttpServer()).post('/api/teams').set('Cookie', adminCk).send({ name: `B-${s}` }).expect(201)).body.id;
    await mk('leada', 'TEAM_LEAD', teamA);
    empA = (await mk('empa', 'EMPLOYEE', teamA)).id;
    empB = (await mk('empb', 'EMPLOYEE', teamB)).id;
    await mk('coordb', 'COORDINATOR', teamB);
    leadACk = await login(`leada-${s}@t.local`, 'Passw0rd1');
    empACk = await login(`empa-${s}@t.local`, 'Passw0rd1');
    coordBCk = await login(`coordb-${s}@t.local`, 'Passw0rd1');
    taskB = (await request(app.getHttpServer()).post('/api/tasks').set('Cookie', adminCk)
      .send({ title: 'Team B secret task', teamId: teamB, ownerId: empB }).expect(201)).body.id;
  });
  afterAll(async () => app.close());

  it('forgot-password never returns a reset token (account takeover fix)', async () => {
    const r = await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: `admin-${s}@t.local` }).expect(200);
    expect(JSON.stringify(r.body)).not.toMatch(/token/i);
    const unknown = await request(app.getHttpServer()).post('/api/auth/forgot-password').send({ email: 'nobody@t.local' }).expect(200);
    expect(unknown.body.message).toBe(r.body.message); // no account enumeration
    const admin = await prisma.user.findUnique({ where: { email: `admin-${s}@t.local` } });
    expect(await prisma.notification.count({ where: { userId: admin!.id, type: 'PASSWORD_RESET_REQUEST' } })).toBeGreaterThan(0);
  });

  it('the old reset-password endpoint is gone', async () => {
    await request(app.getHttpServer()).post('/api/auth/reset-password').send({ token: 'x'.repeat(20), newPassword: 'Newpass123' }).expect(404);
  });

  it('admin issues a temporary password; person must change it', async () => {
    const r = await request(app.getHttpServer()).post(`/api/users/${empA}/reset-password`).set('Cookie', adminCk).expect(201);
    expect(r.body.tempPassword).toMatch(/^[A-Za-z0-9]{10}$/);
    const c = ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email: `empa-${s}@t.local`, password: r.body.tempPassword }).expect(200));
    await request(app.getHttpServer()).get('/api/tasks').set('Cookie', c).expect(403); // PASSWORD_CHANGE_REQUIRED
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', c).expect(200);
    // restore for later tests
    await prisma.user.update({ where: { id: empA }, data: { passwordHash: await argon2.hash('Passw0rd1'), mustChangePassword: false } });
    empACk = await login(`empa-${s}@t.local`, 'Passw0rd1');
  });

  it('coordinator cannot read another team by passing ?teamId=', async () => {
    const mine = await request(app.getHttpServer()).get(`/api/tasks?teamId=${teamA}`).set('Cookie', coordBCk).expect(200);
    expect(mine.body.data.every((t: any) => t.teamId === teamB)).toBe(true);
    await request(app.getHttpServer()).get(`/api/exports/tasks.csv?teamId=${teamA}`).set('Cookie', coordBCk).expect(403);
  });

  it('lead cannot edit or promote people outside their team', async () => {
    await request(app.getHttpServer()).patch(`/api/users/${empB}`).set('Cookie', leadACk).send({ role: 'TEAM_LEAD' }).expect(403);
    await request(app.getHttpServer()).post(`/api/users/${empB}/reset-password`).set('Cookie', leadACk).expect(403);
    await request(app.getHttpServer()).patch(`/api/users/${empA}`).set('Cookie', leadACk).send({ role: 'ADMIN' }).expect(403);
  });

  it('lead cannot assign tasks to a person outside the chosen team', async () => {
    await request(app.getHttpServer()).post('/api/tasks').set('Cookie', leadACk).send({ title: 'x', teamId: teamA, ownerId: empB }).expect(400);
  });

  it('intern cannot move their own deadline or approve their own work', async () => {
    const t = (await request(app.getHttpServer()).post('/api/tasks').set('Cookie', leadACk).send({ title: 'Mine', teamId: teamA, ownerId: empA })).body.id;
    await request(app.getHttpServer()).patch(`/api/tasks/${t}`).set('Cookie', empACk).send({ dueDate: new Date(Date.now() + 9e9).toISOString() }).expect(403);
    await request(app.getHttpServer()).patch(`/api/tasks/${t}`).set('Cookie', empACk).send({ description: 'notes are fine' }).expect(200);
    await request(app.getHttpServer()).patch(`/api/tasks/${t}/status`).set('Cookie', empACk).send({ status: 'DONE' }).expect(403);
  });

  it('employee cannot open another team\'s task', async () => {
    await request(app.getHttpServer()).get(`/api/tasks/${taskB}`).set('Cookie', empACk).expect(403);
  });

  it('bad input returns 4xx, not 500', async () => {
    await request(app.getHttpServer()).get('/api/daily-reports/status?date=not-a-date').set('Cookie', adminCk).expect(400);
    await request(app.getHttpServer()).get('/api/exports/tasks.csv?from=garbage').set('Cookie', adminCk).expect(400);
    await request(app.getHttpServer()).get('/api/tasks/does-not-exist').set('Cookie', adminCk).expect(404);
  });

  it('login locks an account after repeated failures (and a good password is refused while locked)', async () => {
    for (let i = 0; i < 8; i++) await request(app.getHttpServer()).post('/api/auth/login').send({ email: `empa-${s}@t.local`, password: 'wrong-pass-1' }).expect(401);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: `empa-${s}@t.local`, password: 'Passw0rd1' }).expect(429);
  });

  it('health check reports the database', async () => {
    const r = await request(app.getHttpServer()).get('/api/healthz').expect(200);
    expect(r.body.db).toBe('up');
  });
});
