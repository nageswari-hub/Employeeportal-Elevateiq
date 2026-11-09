import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

/**
 * Needs Postgres, like the other e2e specs:  DATABASE_URL=... JWT_ACCESS_SECRET=... UPLOAD_DIR=/tmp/tf npm run test:e2e
 * Covers attendance + breaks + exports, file permissions, and chat (idempotent send, unread, deletion).
 */
describe('attendance, files and chat (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const s = Date.now().toString(36);
  const ck = (r: request.Response) => (r.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  const login = async (email: string) => ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'Passw0rd1' }).expect(200));
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(500, 1)]);
  let admin = '', lead = '', empA = '', empB = '', teamA = '', teamB = '', empAId = '';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    await prisma.setting.upsert({ where: { key: 'requireProfilePhoto' }, update: { value: false as any }, create: { key: 'requireProfilePhoto', value: false as any } });

    const hash = await argon2.hash('Passw0rd1');
    const mk = (n: string, role: any, teamId: string | null = null) =>
      prisma.user.create({ data: { email: `${n}-${s}@t.local`, passwordHash: hash, displayName: n, role, teamId, mustChangePassword: false, createdAt: new Date(Date.now() - 40 * 86_400_000) } });
    await mk('adm', 'ADMIN');
    admin = await login(`adm-${s}@t.local`);
    teamA = (await request(app.getHttpServer()).post('/api/teams').set('Cookie', admin).send({ name: `TA-${s}` }).expect(201)).body.id;
    teamB = (await request(app.getHttpServer()).post('/api/teams').set('Cookie', admin).send({ name: `TB-${s}` }).expect(201)).body.id;
    await mk('lead', 'TEAM_LEAD', teamA);
    empAId = (await mk('empa', 'EMPLOYEE', teamA)).id;
    await mk('empb', 'EMPLOYEE', teamB);
    lead = await login(`lead-${s}@t.local`);
    empA = await login(`empa-${s}@t.local`);
    empB = await login(`empb-${s}@t.local`);
  });
  afterAll(async () => app.close());

  it('check-in, break, back, check-out produce a correct record', async () => {
    const http = () => request(app.getHttpServer());
    await http().post('/api/attendance/break/start').set('Cookie', empA).send({ reason: 'TEA' }).expect(400); // not checked in
    await http().post('/api/attendance/check-in').set('Cookie', empA).send({ mode: 'OFFICE' }).expect(201);
    await http().post('/api/attendance/check-in').set('Cookie', empA).send({}).expect(409); // only once
    await http().post('/api/attendance/break/start').set('Cookie', empA).send({ reason: 'OTHER' }).expect(400); // needs a note
    await http().post('/api/attendance/break/start').set('Cookie', empA).send({ reason: 'LUNCH' }).expect(201);
    await http().post('/api/attendance/break/start').set('Cookie', empA).send({ reason: 'TEA' }).expect(409);
    const board = await http().get('/api/attendance/board').set('Cookie', lead).expect(200);
    expect(board.body.rows.find((r: any) => r.userId === empAId).state).toBe('ON_BREAK');
    await http().post('/api/attendance/break/end').set('Cookie', empA).expect(201);
    const out = await http().post('/api/attendance/check-out').set('Cookie', empA).send({}).expect(201);
    expect(out.body.record.checkOutAt).toBeTruthy();
    await http().post('/api/attendance/check-out').set('Cookie', empA).send({}).expect(400);
  });

  it('visibility: employee sees only self; lead only their team; admin everyone', async () => {
    const http = () => request(app.getHttpServer());
    await http().get('/api/attendance/board').set('Cookie', empA).expect(403);
    const leadBoard = await http().get('/api/attendance/board').set('Cookie', lead).expect(200);
    expect(leadBoard.body.rows.every((r: any) => r.teamId === teamA)).toBe(true);
    const adminBoard = await http().get('/api/attendance/board').set('Cookie', admin).expect(200);
    expect(adminBoard.body.rows.length).toBeGreaterThan(leadBoard.body.rows.length - 1);
    const other = (await prisma.user.findFirst({ where: { email: `empb-${s}@t.local` } }))!;
    await http().get(`/api/attendance/person/${other.id}`).set('Cookie', empA).expect(403);
    await http().get(`/api/attendance/person/${other.id}`).set('Cookie', lead).expect(403);
    await http().get(`/api/attendance/person/${other.id}`).set('Cookie', admin).expect(200);
  });

  it('excel exports download as real xlsx files with the right scope', async () => {
    const http = () => request(app.getHttpServer());
    const bin = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
    for (const q of ['type=day', `type=month&month=${new Date().toISOString().slice(0, 7)}`, `type=person&userId=${empAId}&month=${new Date().toISOString().slice(0, 7)}`]) {
      const r = await http().get(`/api/attendance/export?${q}`).set('Cookie', admin).buffer(true).parse(bin).expect(200);
      expect(r.headers['content-type']).toMatch(/spreadsheetml/);
      expect((r.body as Buffer).slice(0, 2).toString()).toBe('PK');
    }
    await http().get('/api/attendance/export?type=month').set('Cookie', empA).expect(403);
    await http().get('/api/attendance/export?type=day').set('Cookie', empA).expect(403);
    const mine = await http().get(`/api/attendance/export?type=person&userId=${empAId}`).set('Cookie', empA).buffer(true).parse(bin).expect(200);
    expect((mine.body as Buffer).length).toBeGreaterThan(500);
    const csv = await http().get('/api/attendance/export?type=day&format=csv').set('Cookie', admin).expect(200);
    expect(csv.headers['content-type']).toMatch(/csv/);
  });

  it('admin/lead corrections need a reason, notify the person and are limited to the lead\'s team', async () => {
    const http = () => request(app.getHttpServer());
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await http().post('/api/attendance/mark').set('Cookie', lead).send({ userId: empAId, day, status: 'ON_LEAVE' }).expect(400); // reason missing
    await http().post('/api/attendance/mark').set('Cookie', lead).send({ userId: empAId, day, status: 'ON_LEAVE', reason: 'Medical leave approved' }).expect(201);
    const otherTeam = (await prisma.user.findFirst({ where: { email: `empb-${s}@t.local` } }))!;
    await http().post('/api/attendance/mark').set('Cookie', lead).send({ userId: otherTeam.id, day, status: 'ON_LEAVE', reason: 'not my team' }).expect(403);
    expect(await prisma.notification.count({ where: { userId: empAId, type: 'ATTENDANCE' } })).toBeGreaterThan(0);
  });

  it('profile photo is required to check in when the setting is on', async () => {
    const http = () => request(app.getHttpServer());
    await prisma.setting.update({ where: { key: 'requireProfilePhoto' }, data: { value: true as any } });
    const r = await http().post('/api/attendance/check-in').set('Cookie', empB).send({}).expect(400);
    expect(r.body.message).toMatch(/photo/i);
    await http().put('/api/avatars/me').set('Cookie', empB).set('Content-Type', 'application/octet-stream').send(JPG).expect(200);
    await http().post('/api/attendance/check-in').set('Cookie', empB).send({}).expect(201);
    await prisma.setting.update({ where: { key: 'requireProfilePhoto' }, data: { value: false as any } });
  });

  it('files: upload, attach to a task comment, only people who can see the task can download', async () => {
    const http = () => request(app.getHttpServer());
    const owner = (await prisma.user.findFirst({ where: { email: `empa-${s}@t.local` } }))!;
    const task = (await http().post('/api/tasks').set('Cookie', lead).send({ title: 'With files', teamId: teamA, ownerId: owner.id }).expect(201)).body;
    const up = await http().post(`/api/files?context=COMMENT&scopeId=${task.id}&name=brief.pdf`).set('Cookie', empA).set('Content-Type', 'application/octet-stream').send(Buffer.from('%PDF-1.4 test')).expect(201);
    await http().get(`/api/files/${up.body.id}`).set('Cookie', lead).expect(403); // still pending: only the uploader
    await http().post(`/api/tasks/${task.id}/comments`).set('Cookie', empA).send({ body: 'see file', fileIds: [up.body.id] }).expect(201);
    await http().post(`/api/tasks/${task.id}/comments`).set('Cookie', empA).send({ fileIds: [up.body.id] }).expect(400); // cannot reuse a claimed file
    await http().get(`/api/files/${up.body.id}`).set('Cookie', lead).expect(200);
    await http().get(`/api/files/${up.body.id}`).set('Cookie', empB).expect(403); // other team's intern
    const detail = await http().get(`/api/tasks/${task.id}`).set('Cookie', empA).expect(200);
    expect(detail.body.comments[0].files[0].name).toBe('brief.pdf');
    await http().post(`/api/files?context=TASK&scopeId=${task.id}&name=x.txt`).set('Cookie', empB).set('Content-Type', 'application/octet-stream').send(Buffer.from('x')).expect(403);
  });

  it('chat: retry with the same clientId never duplicates; unread counts; delete hides content', async () => {
    const http = () => request(app.getHttpServer());
    const ch = (await http().post('/api/channels').set('Cookie', admin).send({ name: `general-${s}` }).expect(201)).body;
    const a = await http().post(`/api/channels/${ch.id}/messages`).set('Cookie', empA).send({ body: 'hello', clientId: 'abc-1' }).expect(201);
    const b = await http().post(`/api/channels/${ch.id}/messages`).set('Cookie', empA).send({ body: 'hello', clientId: 'abc-1' }).expect(201);
    expect(b.body.id).toBe(a.body.id);
    const list = await http().get('/api/channels').set('Cookie', empB).expect(200);
    expect(list.body.find((c: any) => c.id === ch.id).unread).toBe(1);
    await http().post(`/api/channels/${ch.id}/read`).set('Cookie', empB).expect(201);
    const after = await http().get('/api/channels').set('Cookie', empB).expect(200);
    expect(after.body.find((c: any) => c.id === ch.id).unread).toBe(0);
    await http().post(`/api/channels/${ch.id}/messages`).set('Cookie', empA).send({}).expect(400);
    await http().delete(`/api/channels/${ch.id}/messages/${a.body.id}`).set('Cookie', empB).expect(403);
    await http().delete(`/api/channels/${ch.id}/messages/${a.body.id}`).set('Cookie', empA).expect(200);
    const msgs = await http().get(`/api/channels/${ch.id}/messages`).set('Cookie', empB).expect(200);
    expect(msgs.body.messages[0]).toMatchObject({ deleted: true, body: '' });
  });
});
