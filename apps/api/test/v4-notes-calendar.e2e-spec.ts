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
 * Shared meeting notes + team calendar (meetings, leaves, holidays).
 */
describe('meeting notes + calendar (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const s = Date.now().toString(36);
  const ck = (r: request.Response) => (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  const login = async (email: string) => ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Passw0rd1' }).expect(200));
  let admin = '', lead = '', empA = '', empB = '', teamA = '', teamB = '';

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
    teamA = (await request(app.getHttpServer()).post('/api/teams').set('Cookie', admin).send({ name: `TC-${s}` }).expect(201)).body.id;
    teamB = (await request(app.getHttpServer()).post('/api/teams').set('Cookie', admin).send({ name: `TD-${s}` }).expect(201)).body.id;
    await mk('lead', 'TEAM_LEAD', teamA);
    await mk('empa', 'EMPLOYEE', teamA);
    await mk('empb', 'EMPLOYEE', teamB);
    lead = await login(`lead-${s}@t.local`);
    empA = await login(`empa-${s}@t.local`);
    empB = await login(`empb-${s}@t.local`);
  }, 60000);
  afterAll(async () => app.close());

  it('one shared note per meeting, visible to attendees only', async () => {
    const http = () => request(app.getHttpServer());
    const starts = new Date(Date.now() + 60 * 60_000).toISOString();
    const m = await http().post('/api/meetings').set('Cookie', lead)
      .send({ teamId: teamA, title: 'Notes meet', meetUrl: 'https://meet.example.com/notes', startsAt: starts }).expect(201);
    await http().patch(`/api/meetings/${m.body.id}/note`).set('Cookie', empA).send({ note: 'Decided: ship Friday' }).expect(200);
    const seen = await http().get('/api/meetings').set('Cookie', empA).expect(200);
    expect(seen.body.find((x: any) => x.id === m.body.id).note).toBe('Decided: ship Friday');
    // other team's member cannot see or write
    const other = await http().get('/api/meetings').set('Cookie', empB).expect(200);
    expect(other.body.some((x: any) => x.id === m.body.id)).toBe(false);
    await http().patch(`/api/meetings/${m.body.id}/note`).set('Cookie', empB).send({ note: 'hijack' }).expect(403);
  });

  it('calendar shows meetings, leaves and holidays in one view', async () => {
    const http = () => request(app.getHttpServer());
    const month = new Date().toISOString().slice(0, 7);
    const day = `${month}-15`;
    await prisma.setting.upsert({ where: { key: 'holidays' }, update: { value: [day] as any }, create: { key: 'holidays', value: [day] as any } });
    const starts = new Date(`${day}T10:00:00Z`).toISOString();
    await http().post('/api/meetings').set('Cookie', lead)
      .send({ teamId: teamA, title: 'Cal meet', meetUrl: 'https://meet.example.com/cal', startsAt: starts }).expect(201);
    const lv = await http().post('/api/leaves').set('Cookie', empA).send({ fromDate: day, toDate: day, reason: 'fever' }).expect(201);
    await http().post(`/api/leaves/${lv.body.id}/approve`).set('Cookie', lead).send({}).expect(201);
    const cal = await http().get(`/api/calendar?month=${month}`).set('Cookie', empA).expect(200);
    expect(cal.body.days[day].isHoliday).toBe(true);
    expect(cal.body.days[day].meetings.some((m: any) => m.title === 'Cal meet')).toBe(true);
    expect(cal.body.days[day].leaves.length).toBeGreaterThanOrEqual(1);
    await http().get(`/api/calendar?month=${month}`).set('Cookie', empB).expect(200);
    await http().get('/api/calendar?month=nope').set('Cookie', empA).expect(400);
    await prisma.setting.deleteMany({ where: { key: 'holidays' } });
  });
});
