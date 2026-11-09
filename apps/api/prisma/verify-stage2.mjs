// Stage 2 verification — run with: DATABASE_URL=... node prisma/verify-stage2.mjs
// Tests tables, FKs, CHECKs, uniques, indexes. Exits non-zero on failure.
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log(`PASS ${n}`); } else { fail++; console.log(`FAIL ${n}`); } };
const mustFail = async (n, fn) => {
  try { await fn(); fail++; console.log(`FAIL ${n} (should have thrown)`); }
  catch { pass++; console.log(`PASS ${n} (rejected as expected)`); }
};

const uid = () => Math.random().toString(36).slice(2, 9);
const s = uid();

try {
  // 1. tables exist (expect 25 app tables)
  const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('_prisma_migrations') ORDER BY 1`;
  const names = tables.map(t => t.tablename);
  ok(`tables count=${names.length} >=25`, names.length >= 25);
  for (const t of ['users','teams','batches','goals','tasks','daily_reports','training_plans','assessments','announcements','audit_logs','settings','batch_evaluations']) ok(`table ${t}`, names.includes(t));

  // 2. seed org
  const admin = await db.user.create({ data: { email: `admin${s}@t.local`, passwordHash: 'x'.repeat(60), role: 'ADMIN', displayName: 'Admin', mustChangePassword: false } });
  const team = await db.team.create({ data: { name: `Team${s}`, leadId: admin.id, createdById: admin.id } });
  const batch = await db.batch.create({ data: { name: `Batch${s}`, startDate: new Date('2026-01-01'), endDate: new Date('2026-03-01'), durationDays: 60, leadId: admin.id, createdById: admin.id } });
  const emp = await db.user.create({ data: { email: `emp${s}@t.local`, passwordHash: 'y'.repeat(60), role: 'EMPLOYEE', displayName: 'Emp', teamId: team.id, batchId: batch.id } });
  ok('org seed', !!emp.id);

  // 3. batch date CHECK
  await mustFail('batch end<start rejected', () => db.batch.create({ data: { name: `Bad${s}`, startDate: new Date('2026-03-01'), endDate: new Date('2026-01-01'), durationDays: 10 } }));

  // 4. task flow + BLOCKED CHECK
  const goal = await db.goal.create({ data: { title: `Goal${s}`, type: 'WEEKLY', teamId: team.id, createdById: admin.id } });
  const task = await db.task.create({ data: { title: `Task${s}`, teamId: team.id, ownerId: emp.id, createdById: admin.id, goalId: goal.id } });
  ok('task TODO created', task.status === 'TODO');
  await mustFail('BLOCKED without reason rejected', () => db.task.update({ where: { id: task.id }, data: { status: 'BLOCKED' } }));
  await db.task.update({ where: { id: task.id }, data: { status: 'BLOCKED', blockedReason: 'waiting on VPN' } });
  ok('BLOCKED with reason accepted', true);
  await db.taskComment.create({ data: { taskId: task.id, authorId: emp.id, body: 'working on it' } });
  await mustFail('empty comment rejected', () => db.taskComment.create({ data: { taskId: task.id, authorId: emp.id, body: '   ' } }));

  // 5. daily reports: hours CHECK + unique(user,date)
  await mustFail('hours 25 rejected', () => db.dailyReport.create({ data: { userId: emp.id, teamId: team.id, reportDate: new Date('2026-09-01'), didToday: 'a', planTomorrow: 'b', hoursWorked: 25 } }));
  const r1 = await db.dailyReport.create({ data: { userId: emp.id, teamId: team.id, batchId: batch.id, reportDate: new Date('2026-09-01'), didToday: 'did X', planTomorrow: 'do Y', hoursWorked: 7.5 } });
  ok('report 7.5h created', Number(r1.hoursWorked) === 7.5);
  await mustFail('duplicate report same day rejected', () => db.dailyReport.create({ data: { userId: emp.id, teamId: team.id, reportDate: new Date('2026-09-01'), didToday: 'dup', planTomorrow: 'dup', hoursWorked: 2 } }));
  // editable: update allowed
  await db.dailyReport.update({ where: { id: r1.id }, data: { didToday: 'did X edited' } });
  ok('report editable', true);

  // 6. attachment size CHECK
  await mustFail('11MB attachment rejected', () => db.taskAttachment.create({ data: { taskId: task.id, fileKey: 'k', fileName: 'f', mimeType: 'application/pdf', sizeBytes: 11 * 1024 * 1024, uploadedById: admin.id } }));

  // 7. key indexes exist
  const idx = await db.$queryRaw`SELECT indexname FROM pg_indexes WHERE schemaname='public'`;
  const ix = new Set(idx.map(i => i.indexname));
  for (const i of ['tasks_ownerId_status_idx','tasks_teamId_status_idx','daily_reports_teamId_reportDate_idx','audit_logs_createdAt_idx','notifications_userId_isRead_createdAt_idx']) ok(`index ${i}`, ix.has(i));

  // 8. CHECK constraints exist
  const chk = await db.$queryRaw`SELECT conname FROM pg_constraint WHERE contype='c' AND connamespace='public'::regnamespace`;
  const cn = new Set(chk.map(c => c.conname));
  for (const c of ['tasks_blocked_reason_chk','daily_reports_hours_chk','batches_dates_chk','task_attachments_size_chk']) ok(`check ${c}`, cn.has(c));

  console.log(`\nRESULT pass=${pass} fail=${fail}`);
  if (fail > 0) process.exitCode = 1;
} catch (e) { console.error('FATAL', e); process.exitCode = 1; }
finally { await db.$disconnect(); }
