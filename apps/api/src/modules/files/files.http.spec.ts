import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';

// Set BEFORE the service module is loaded (limits are read once at import time)
const dir = mkdtempSync(join(tmpdir(), 'tf-up-'));
process.env.UPLOAD_DIR = dir;
process.env.MAX_UPLOAD_MB = '1';
process.env.ACCEL_REDIRECT = 'false';

/* eslint-disable @typescript-eslint/no-var-requires */
const { FilesController } = require('./files.controller');
const { FilesService } = require('./files.service');
const { PrismaService } = require('../../prisma/prisma.service');
const { AuditService } = require('../audit/audit.service');
const { UserCacheService } = require('../../common/user-cache.service');
const { RealtimeGateway } = require('../comms/realtime.gateway');
const { NotificationsService } = require('../comms/notifications.service');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2000, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 3)]);

describe('file upload & download over real HTTP', () => {
  let app: INestApplication;
  const files = new Map<string, any>();
  const users = new Map<string, any>([['u1', { id: 'u1', avatarFileId: null, teamId: null }]]);
  let seq = 0;

  const prisma = {
    fileAsset: {
      create: async ({ data, select }: any) => {
        const row = { id: `f${++seq}`, createdAt: new Date(), deletedAt: null, taskId: null, commentId: null, messageId: null, reportId: null, announcementId: null, ...data };
        files.set(row.id, row);
        if (!select) return row;
        return Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, (row as any)[k]])); // honour `select` like Prisma does
      },
      update: async ({ where, data }: any) => Object.assign(files.get(where.id), data),
      findUnique: async ({ where }: any) => files.get(where.id) ?? null,
      findFirst: async ({ where }: any) => { const f = files.get(where.id); return f && !f.deletedAt ? f : null; },
      updateMany: async ({ where, data }: any) => { const f = files.get(where.id); if (f) Object.assign(f, data); return { count: f ? 1 : 0 }; },
    },
    user: {
      findUnique: async ({ where }: any) => (users.has(where.id) ? { ...users.get(where.id) } : null), // a snapshot, like a real database row
      update: async ({ where, data }: any) => Object.assign(users.get(where.id), data),
      findMany: async () => [...users.values()].filter((u) => u.avatarFileId).map((u) => ({ id: u.id, avatarFileId: u.avatarFileId })),
    },
    task: { findUnique: async () => null },
  };
  const me = { id: 'u1', role: 'ADMIN', teamId: null, displayName: 'Admin', email: 'a@x', batchId: null };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        FilesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: async () => {} } },
        { provide: UserCacheService, useValue: { invalidate: () => {}, get: async () => me } },
        { provide: RealtimeGateway, useValue: { server: { emit: () => {} } } },
        { provide: NotificationsService, useValue: { notify: async () => [] } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.use((req: any, _res: any, next: any) => { req.user = me; next(); });
    app.setGlobalPrefix('api');
    app.useGlobalFilters({ catch: (e: any, h: any) => { const r = h.switchToHttp().getResponse(); r.status(e?.getStatus?.() ?? 500).json({ message: e?.message }); } } as any);
    await app.init();
  });
  afterAll(async () => app.close());

  const up = (name: string, body: Buffer, ctx = 'ANNOUNCEMENT') =>
    request(app.getHttpServer()).post(`/api/files?context=${ctx}&name=${encodeURIComponent(name)}`).set('Content-Type', 'application/octet-stream').send(body);

  it('stores a file, returns metadata only, and serves identical bytes back as a safe download', async () => {
    const r = await up('Report Q3.png', PNG).expect(201);
    expect(r.body).toMatchObject({ name: 'Report Q3.png', mime: 'image/png', size: PNG.length });
    expect(r.body.storageKey).toBeUndefined();
    expect(r.body.sha256).toBeUndefined();
    const on = readdirSync(join(dir, new Date().getUTCFullYear().toString())); // yyyy/mm/uuid layout
    expect(on.length).toBeGreaterThan(0);

    const dl = await request(app.getHttpServer()).get(`/api/files/${r.body.id}`).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(Buffer.compare(dl.body as Buffer, PNG)).toBe(0);
    expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-security-policy']).toMatch(/sandbox/);
    const inline = await request(app.getHttpServer()).get(`/api/files/${r.body.id}?inline=1`).expect(200);
    expect(inline.headers['content-disposition']).toMatch(/^inline;/);
    expect(inline.headers['content-type']).toMatch(/image\/png/);
  });

  it('supports range requests (video seeking / resumable downloads)', async () => {
    const r = await up('clip.bin', Buffer.alloc(5000, 1)).expect(201);
    const part = await request(app.getHttpServer()).get(`/api/files/${r.body.id}`).set('Range', 'bytes=0-99').expect(206);
    expect(part.headers['content-range']).toMatch(/^bytes 0-99\/5000$/);
  });

  it('never lets html / svg / scripts run in the browser, even if inline is requested', async () => {
    const html = Buffer.from('<html><script>alert(document.cookie)</script></html>');
    for (const name of ['evil.html', 'evil.svg', 'photo.png']) {
      const r = await up(name, html).expect(201);
      expect(r.body.mime).toBe('application/octet-stream');
      const dl = await request(app.getHttpServer()).get(`/api/files/${r.body.id}?inline=1`).expect(200);
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['content-type']).toMatch(/octet-stream/);
    }
  });

  it('accepts any file type, including programs (flagged in the UI, still allowed)', async () => {
    const r = await up('setup.exe', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(500, 1)])).expect(201);
    expect(r.body.name).toBe('setup.exe');
    await up('weird.xyz123', Buffer.from('hello')).expect(201);
    await up('рапорт.docx', Buffer.from([0x50, 0x4b, 3, 4, 1, 2, 3, 4])).expect(201);
  });

  it('rejects empty and oversized uploads, and leaves no temp files behind', async () => {
    await up('empty.txt', Buffer.alloc(0)).expect(400);
    await up('big.bin', Buffer.alloc(1024 * 1024 + 1024, 9)).expect(413);
    await up('x.txt', Buffer.from('x'), 'NOPE').expect(400);
    const tmpLeft = existsSync(join(dir, 'tmp')) ? readdirSync(join(dir, 'tmp')) : [];
    expect(tmpLeft).toEqual([]);
  });

  it('profile photo: only real JPEG/PNG/WebP, and old photo is retired on change', async () => {
    await request(app.getHttpServer()).put('/api/avatars/me').set('Content-Type', 'application/octet-stream').send(Buffer.from('not an image at all')).expect(400);
    const a = await request(app.getHttpServer()).put('/api/avatars/me').set('Content-Type', 'application/octet-stream').send(JPG).expect(200);
    expect(users.get('u1').avatarFileId).toBe(a.body.avatarFileId);
    const first = a.body.avatarFileId;
    const b = await request(app.getHttpServer()).put('/api/avatars/me').set('Content-Type', 'application/octet-stream').send(PNG).expect(200);
    expect(b.body.avatarFileId).not.toBe(first);
    expect(files.get(first).deletedAt).toBeInstanceOf(Date);
    const map = await request(app.getHttpServer()).get('/api/avatars').expect(200);
    expect(typeof map.body).toBe('object');
    const img = await request(app.getHttpServer()).get(`/api/avatars/u1?v=${b.body.avatarFileId}`); expect(img.status).toBe(200);
    expect(img.headers['cache-control']).toMatch(/immutable/);
  });

  it('refuses to serve deleted files', async () => {
    const r = await up('gone.txt', Buffer.from('bye')).expect(201);
    await request(app.getHttpServer()).delete(`/api/files/${r.body.id}`).expect(200);
    await request(app.getHttpServer()).get(`/api/files/${r.body.id}`).expect(404);
  });
});
