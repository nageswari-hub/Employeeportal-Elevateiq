import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { JobsService } from '../src/modules/jobs/jobs.service';

/**
 * Needs Postgres: DATABASE_URL=... JWT_ACCESS_SECRET=... UPLOAD_DIR=/tmp/tf npm run test:e2e
 * Meeting reminders fire once, 15 min before start, to the right people.
 */
describe('meeting reminders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jobs: JobsService;
  const s = Date.now().toString(36);
  const ck = (r: request.Response) => (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  const login = async (email: string) => ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Passw0rd1' }).expect(200));
  let admin = '', lead = '', empA = '', teamA = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    jobs = app.get(JobsService);
    const hash = await argon2.hash('Passw0rd1');
    const mk = (n: string, role: any, teamId: string | null = null) =>
      prisma.user.create({ data: { email: `${n}-${s}@t.local`, passwordHash: hash, displayName: n, role, teamId, mustChangePassword: false } });
    await mk('adm', 'ADMIN');
    admin = await login(`adm-${s}@t.local`);
    teamA = (await request(app.getHttpServer()).post('/api/teams').set('Cookie', admin).send({ name: `TM-${s}` }).expect(201)).body.id;
    await mk('lead', 'TEAM_LEAD', teamA);
    await mk('empa', 'EMPLOYEE', teamA);
    lead = await login(`lead-${s}@t.local`);
    empA = await login(`empa-${s}@t.local`);
  }, 60000);
  afterAll(async () => app.close());

  it('reminds the team once, 15 min before; far meetings stay silent', async () => {
    const http = () => request(app.getHttpServer());
    const soon = new Date(Date.now() + 10 * 60_000).toISOString();
    const later = new Date(Date.now() + 2 * 60_60_000).toISOString();
    await http().post('/api/meetings').set('Cookie', lead)
      .send({ teamId: teamA, title: 'Soon standup', meetUrl: 'https://meet.example.com/soon', startsAt: soon }).expect(201);
    await http().post('/api/meetings').set('Cookie', lead)
      .send({ teamId: teamA, title: 'Later review', meetUrl: 'https://meet.example.com/later', startsAt: later }).expect(201);

    await (jobs as any).meetingReminders();
    const first = await http().get('/api/notifications?unread=true').set('Cookie', empA).expect(200);
    expect(first.body.data.some((n: any) => n.type === 'MEETING_REMINDER' && n.title.includes('Soon standup'))).toBe(true);
    expect(first.body.data.some((n: any) => n.type === 'MEETING_REMINDER' && n.title.includes('Later review'))).toBe(false);

    const before = await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } });
    await (jobs as any).meetingReminders();
    const after = await prisma.notification.count({ where: { type: 'MEETING_REMINDER' } });
    expect(after).toBe(before); // no duplicates on re-tick
  });
});
