import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('TeamFlow Stage 7 e2e (comms + realtime)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let port = 0;
  const s = Date.now().toString();
  const adminEmail = `s7admin${s}@t.local`;
  const leadEmail = `s7lead${s}@t.local`;
  const empEmail = `s7emp${s}@t.local`;
  let teamId = '';
  let taskId = '';
  let adminCk = '';
  let leadCk = '';
  let empCk = '';

  const ck = (res: any) => (((res.headers as any)['set-cookie'] ?? []) as string[]).map((x) => x.split(';')[0]).join('; ');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0);
    port = app.getHttpServer().address().port;
    prisma = app.get(PrismaService);

    await prisma.user.create({
      data: { email: adminEmail, passwordHash: await argon2.hash('Admin1234'), displayName: 'A', role: 'ADMIN', mustChangePassword: false },
    });
    adminCk = ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password: 'Admin1234' }).expect(200));

    const team = await request(app.getHttpServer()).post('/api/teams').set('Cookie', adminCk).send({ name: `S7T${s}` }).expect(201);
    teamId = team.body.id;

    await request(app.getHttpServer()).post('/api/users').set('Cookie', adminCk)
      .send({ email: leadEmail, password: 'Lead1234x', displayName: 'L', role: 'TEAM_LEAD', teamId }).expect(201);
    await request(app.getHttpServer()).post('/api/users').set('Cookie', adminCk)
      .send({ email: empEmail, password: 'Emp12345x', displayName: 'E', role: 'EMPLOYEE', teamId }).expect(201);

    const l1 = await request(app.getHttpServer()).post('/api/auth/login').send({ email: leadEmail, password: 'Lead1234x' }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/change-password').set('Cookie', ck(l1)).send({ currentPassword: 'Lead1234x', newPassword: 'Lead5678x' }).expect(200);
    leadCk = ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email: leadEmail, password: 'Lead5678x' }).expect(200));

    const e1 = await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp12345x' }).expect(200);
    await request(app.getHttpServer()).post('/api/auth/change-password').set('Cookie', ck(e1)).send({ currentPassword: 'Emp12345x', newPassword: 'Emp56789x' }).expect(200);
    empCk = ck(await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp56789x' }).expect(200));
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  it('announcements: admin company post, lead team post, employee read + RBAC', async () => {
    const a1 = await request(app.getHttpServer()).post('/api/announcements').set('Cookie', adminCk)
      .send({ title: `All hands ${s}`, body: 'Townhall Friday', scope: 'COMPANY' }).expect(201);
    expect(a1.body.scope).toBe('COMPANY');

    // lead cannot post company-wide
    await request(app.getHttpServer()).post('/api/announcements').set('Cookie', leadCk)
      .send({ title: 'Nope', body: 'x', scope: 'COMPANY' }).expect(403);

    // lead team post (own team implied)
    const a2 = await request(app.getHttpServer()).post('/api/announcements').set('Cookie', leadCk)
      .send({ title: `Sprint ${s}`, body: 'Focus week', scope: 'TEAM', teamId }).expect(201);
    expect(a2.body.teamId).toBe(teamId);

    // employee sees both, cannot post
    const feed = await request(app.getHttpServer()).get('/api/announcements').set('Cookie', empCk).expect(200);
    expect(feed.body.length).toBeGreaterThanOrEqual(2);
    await request(app.getHttpServer()).post('/api/announcements').set('Cookie', empCk)
      .send({ title: 'Hi', body: 'x', scope: 'TEAM', teamId }).expect(403);

    // employee got ANNOUNCEMENT notification
    const n = await request(app.getHttpServer()).get('/api/notifications?unread=true').set('Cookie', empCk).expect(200);
    expect(n.body.unread).toBeGreaterThanOrEqual(1);

    // delete by non-creator lead? admin's post cannot be deleted by lead
    await request(app.getHttpServer()).delete(`/api/announcements/${a1.body.id}`).set('Cookie', leadCk).expect(403);
    await request(app.getHttpServer()).delete(`/api/announcements/${a2.body.id}`).set('Cookie', leadCk).expect(200);
  });

  it('channels: company + team, messages, isolation', async () => {
    const comp = await request(app.getHttpServer()).post('/api/channels').set('Cookie', adminCk)
      .send({ teamId: null, name: `general-${s}` }).expect(201);
    // lead cannot create company channel
    await request(app.getHttpServer()).post('/api/channels').set('Cookie', leadCk).send({ teamId: null, name: 'hack' }).expect(403);
    const team = await request(app.getHttpServer()).post('/api/channels').set('Cookie', leadCk)
      .send({ teamId, name: 'standup' }).expect(201);

    // employee sees company + own team channels
    const list = await request(app.getHttpServer()).get('/api/channels').set('Cookie', empCk).expect(200);
    const ids = list.body.map((c: any) => c.id);
    expect(ids).toContain(comp.body.id);
    expect(ids).toContain(team.body.id);

    const m1 = await request(app.getHttpServer()).post(`/api/channels/${team.body.id}/messages`).set('Cookie', empCk)
      .send({ body: 'Done for today' }).expect(201);
    expect(m1.body.body).toBe('Done for today');
    const hist = await request(app.getHttpServer()).get(`/api/channels/${team.body.id}/messages`).set('Cookie', leadCk).expect(200);
    expect(hist.body.length).toBeGreaterThanOrEqual(1);
  });

  it('task assign creates notification; socket receives live comment', async () => {
    const emp = await prisma.user.findUnique({ where: { email: empEmail } });
    const t = await request(app.getHttpServer()).post('/api/tasks').set('Cookie', leadCk)
      .send({ title: `Live job ${s}`, teamId, ownerId: emp!.id }).expect(201);
    taskId = t.body.id;

    const n = await request(app.getHttpServer()).get('/api/notifications?unread=true').set('Cookie', empCk).expect(200);
    expect(n.body.data.some((x: any) => x.type === 'TASK_ASSIGNED' && x.link === `/tasks/${taskId}`)).toBe(true);

    // mark read
    const first = n.body.data[0];
    await request(app.getHttpServer()).post(`/api/notifications/${first.id}/read`).set('Cookie', empCk).expect(201);

    // live socket: emp joins task room, lead comments via HTTP, emp receives event
    const access = empCk.split(';').map((p) => p.trim()).find((p) => p.startsWith('access=')) ?? '';
    const sock: Socket = io(`http://localhost:${port}`, { extraHeaders: { Cookie: access }, transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      sock.on('connect', () => resolve());
      sock.on('connect_error', (e) => reject(e));
      setTimeout(() => reject(new Error('connect timeout')), 8000);
    });
    const joined = await sock.emitWithAck('joinTask', { taskId });
    expect(joined).toEqual({ ok: true });
    const got = new Promise<any>((resolve, reject) => {
      sock.on('comment:added', (m) => resolve(m));
      setTimeout(() => reject(new Error('event timeout')), 8000);
    });
    await request(app.getHttpServer()).post(`/api/tasks/${taskId}/comments`).set('Cookie', leadCk).send({ body: 'Looks good, keep going' }).expect(201);
    const evt = await got;
    expect(evt.body).toBe('Looks good, keep going');
    sock.disconnect();
  });
});
