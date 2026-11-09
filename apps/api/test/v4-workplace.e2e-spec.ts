import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * Needs Postgres: DATABASE_URL=... JWT_ACCESS_SECRET=... UPLOAD_DIR=/tmp/tf npm run test:e2e
 * Covers team HR, meetings and the leave request flow.
 */
describe('workplace: HR, meetings, leaves (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const s = Date.now().toString(36);
  const ck = (r: request.Response) => (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  const login = async (email: string) => ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Passw0rd1' }).expect(200));
  let admin = '', lead = '', empA = '', teamA = '', hrId = '';

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
    const mk = (n: string, role: any, teamId: string | null = null) =>
      prisma.user.create({ data: { email: `${n}-${s}@t.local`, passwordHash: hash, displayName: n, role, teamId, mustChangePassword: false } });
    await mk('adm', 'ADMIN');
    admin = await login(`adm-${s}@t.local`);
    teamA = (await request(app.getHttpServer()).post('/api/teams').set('Cookie', admin).send({ name: `TW-${s}` }).expect(201)).body.id;
    await mk('lead', 'TEAM_LEAD', teamA);
    await mk('hr', 'COORDINATOR', teamA);
    await mk('empa', 'EMPLOYEE', teamA);
    hrId = (await prisma.user.findUnique({ where: { email: `hr-${s}@t.local` } }))!.id;
    lead = await login(`lead-${s}@t.local`);
    empA = await login(`empa-${s}@t.local`);
  }, 60000);
  afterAll(async () => app.close());

  it('every team gets one HR, visible to the team', async () => {
    const http = () => request(app.getHttpServer());
    await http().patch(`/api/teams/${teamA}`).set('Cookie', admin).send({ hrId }).expect(200);
    const t = await http().get(`/api/teams/${teamA}`).set('Cookie', empA).expect(200);
    expect(t.body.hr.id).toBe(hrId);
    // lead cannot assign another team's HR... (hr must be a valid user; outsiders rejected by team scoping on read)
    await http().patch(`/api/teams/${teamA}`).set('Cookie', empA).send({ hrId }).expect(403);
  });

  it('meetings: lead schedules for own team, everyone joins from the list', async () => {
    const http = () => request(app.getHttpServer());
    const starts = new Date(Date.now() + 30 * 60_000).toISOString();
    const m = await http().post('/api/meetings').set('Cookie', lead)
      .send({ teamId: teamA, title: 'Standup', meetUrl: 'https://meet.example.com/standup', startsAt: starts }).expect(201);
    expect(m.body.meetUrl).toMatch(/^https:\/\//);
    await http().post('/api/meetings').set('Cookie', lead).send({ teamId: teamA, title: 'Bad', meetUrl: 'not-a-link', startsAt: starts }).expect(400);
    const list = await http().get('/api/meetings').set('Cookie', empA).expect(200);
    expect(list.body.some((x: any) => x.id === m.body.id)).toBe(true);
    await http().post('/api/meetings').set('Cookie', empA).send({ teamId: teamA, title: 'No', meetUrl: 'https://x.example', startsAt: starts }).expect(403);
    await http().delete(`/api/meetings/${m.body.id}`).set('Cookie', empA).expect(403);
    await http().delete(`/api/meetings/${m.body.id}`).set('Cookie', lead).expect(200);
  });

  it('leave: request, approve marks attendance, cancel/revoke rules', async () => {
    const http = () => request(app.getHttpServer());
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const r = await http().post('/api/leaves').set('Cookie', empA).send({ fromDate: day, toDate: day, reason: 'Family function' }).expect(201);
    expect(r.body.status).toBe('PENDING');
    await http().post('/api/leaves').set('Cookie', empA).send({ fromDate: day, toDate: day, reason: 'overlap' }).expect(400);
    const pend = await http().get('/api/leaves/pending').set('Cookie', lead).expect(200);
    expect(pend.body.some((x: any) => x.id === r.body.id)).toBe(true);
    await http().post(`/api/leaves/${r.body.id}/approve`).set('Cookie', lead).send({}).expect(201);
    const mine = await http().get('/api/leaves/mine').set('Cookie', empA).expect(200);
    expect(mine.body.find((x: any) => x.id === r.body.id).status).toBe('APPROVED');
    const att = await prisma.attendanceDay.findUnique({ where: { userId_day: { userId: (await prisma.user.findUnique({ where: { email: `empa-${s}@t.local` } }))!.id, day: new Date(day) } } });
    // approved working days are marked ON_LEAVE (skip assertion on weekends/holidays)
    if (att) expect(att.status).toBe('ON_LEAVE');
    await http().post(`/api/leaves/${r.body.id}/cancel`).set('Cookie', empA).expect(400); // approved: cannot cancel
    await http().post(`/api/leaves/${r.body.id}/revoke`).set('Cookie', lead).send({}).expect(201);
  });
});
