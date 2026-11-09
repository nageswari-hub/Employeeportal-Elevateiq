import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('TeamFlow Stage 3 e2e (auth + RBAC + tasks)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const adminEmail = `admin${Date.now()}@t.local`;
  const leadEmail = `lead${Date.now()}@t.local`;
  const empEmail = `emp${Date.now()}@t.local`;
  let teamId = '';
  let taskId = '';

  const cookies = (res: any): string[] => res.headers['set-cookie'] ?? [];
  const joinCookies = (c: string[]) => c.map((s) => s.split(';')[0]).join('; ');

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.user.create({
      data: { email: adminEmail, passwordHash: await argon2.hash('Admin1234'), displayName: 'Admin', role: 'ADMIN', mustChangePassword: false },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('healthz is public', async () => {
    await request(app.getHttpServer()).get('/api/healthz').expect(200);
  });

  it('admin login + me', async () => {
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password: 'Admin1234' }).expect(200);
    const ck = joinCookies(cookies(login));
    const me = await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', ck).expect(200);
    expect(me.body.email).toBe(adminEmail);
  });

  it('RBAC: employee cannot create team', async () => {
    const emp = await prisma.user.create({
      data: { email: empEmail, passwordHash: await argon2.hash('Emp12345'), displayName: 'Emp', role: 'EMPLOYEE', mustChangePassword: false },
    });
    void emp;
    const login = await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp12345' }).expect(200);
    const ck = joinCookies(cookies(login));
    await request(app.getHttpServer()).post('/api/teams').set('Cookie', ck).send({ name: 'Nope' }).expect(403);
  });

  it('admin creates team + lead + task flow', async () => {
    const adminLogin = await request(app.getHttpServer()).post('/api/auth/login').send({ email: adminEmail, password: 'Admin1234' }).expect(200);
    const adminCk = joinCookies(cookies(adminLogin));

    const team = await request(app.getHttpServer()).post('/api/teams').set('Cookie', adminCk).send({ name: `T${Date.now()}` }).expect(201);
    teamId = team.body.id;

    await request(app.getHttpServer()).post('/api/users').set('Cookie', adminCk).send({
      email: leadEmail, password: 'Lead1234', displayName: 'Lead', role: 'TEAM_LEAD', teamId,
    }).expect(201);

    const empRow = await prisma.user.findUnique({ where: { email: empEmail } });
    await request(app.getHttpServer()).patch(`/api/users/${empRow!.id}`).set('Cookie', adminCk).send({ teamId }).expect(200);

    const task = await request(app.getHttpServer()).post('/api/tasks').set('Cookie', adminCk).send({
      title: 'Onboard Reddy', teamId, ownerId: empRow!.id,
    }).expect(201);
    taskId = task.body.id;

    // BLOCKED without reason -> 400 (DTO + DB CHECK)
    const empLogin = await request(app.getHttpServer()).post('/api/auth/login').send({ email: empEmail, password: 'Emp12345' }).expect(200);
    const empCk = joinCookies(cookies(empLogin));
    await request(app.getHttpServer()).patch(`/api/tasks/${taskId}/status`).set('Cookie', empCk).send({ status: 'BLOCKED' }).expect(400);
    await request(app.getHttpServer()).patch(`/api/tasks/${taskId}/status`).set('Cookie', empCk).send({ status: 'BLOCKED', blockedReason: 'VPN down' }).expect(200);

    // employee cannot mark DONE
    await request(app.getHttpServer()).patch(`/api/tasks/${taskId}/status`).set('Cookie', empCk).send({ status: 'DONE' }).expect(403);

    // lead approves
    const leadLogin = await request(app.getHttpServer()).post('/api/auth/login').send({ email: leadEmail, password: 'Lead1234' }).expect(200);
    void leadLogin;
    // lead must change password first (seeded mustChangePassword=true) -> change then retry
    // NOTE: lead was created with mustChangePassword=true by API
    await request(app.getHttpServer()).post('/api/auth/change-password')
      .set('Cookie', joinCookies(cookies(leadLogin)))
      .send({ currentPassword: 'Lead1234', newPassword: 'Lead5678' })
      .expect(200);
    const leadLogin2 = await request(app.getHttpServer()).post('/api/auth/login').send({ email: leadEmail, password: 'Lead5678' }).expect(200);
    const leadCk = joinCookies(cookies(leadLogin2));
    await request(app.getHttpServer()).patch(`/api/tasks/${taskId}/status`).set('Cookie', leadCk).send({ status: 'DONE' }).expect(200);
  });
});
