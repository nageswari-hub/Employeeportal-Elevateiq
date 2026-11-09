import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

// Seed first admin from env: ADMIN_EMAIL / ADMIN_PASSWORD (min 8 chars + letter/number)
// Run: ADMIN_EMAIL=admin@teamflow.local ADMIN_PASSWORD=Admin1234 npm run seed
async function main() {
  const prisma = new PrismaClient();
  try {
    const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD ?? '';
    if (!email || !password) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars');
    if (password.length < 8) throw new Error('ADMIN_PASSWORD must be 8+ chars');
    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) {
      console.log(`Admin already exists: ${email}`);
      return;
    }
    const admin = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(password),
        displayName: 'Administrator',
        role: 'ADMIN',
        mustChangePassword: true,
      },
    });
    await prisma.setting.upsert({
      where: { key: 'reportDeadline' },
      update: {},
      create: { key: 'reportDeadline', value: { time: process.env.REPORT_DEADLINE ?? '18:00', tz: process.env.APP_TZ ?? 'Asia/Kolkata' } as any },
    });
    // Sensible calendar defaults (admin can change them in Settings): Monday-Saturday working week, no holidays.
    await prisma.setting.upsert({ where: { key: 'workDays' }, update: {}, create: { key: 'workDays', value: [1, 2, 3, 4, 5, 6] as any } });
    await prisma.setting.upsert({ where: { key: 'holidays' }, update: {}, create: { key: 'holidays', value: [] as any } });
    console.log(`Seeded admin: ${admin.email} (mustChangePassword=true)`);
  } finally {
    const { PrismaClient: PC } = await import('@prisma/client');
    void PC;
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  })
  .finally(async () => {
    const { PrismaClient } = await import('@prisma/client');
    await new PrismaClient().$disconnect().catch(() => null);
  });
