import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { AttendanceService } from './modules/attendance/attendance.service';
import { FilesService } from './modules/files/files.service';
import { ChannelsService } from './modules/comms/channels.service';
import { JobsService } from './modules/jobs/jobs.service';

/** Boots the whole dependency graph with a fake database: catches missing providers / circular imports without Postgres. */
describe('application wiring', () => {
  it('resolves every module and provider', async () => {
    process.env.JWT_ACCESS_SECRET = 'x'.repeat(40);
    const fakePrisma = new Proxy({}, { get: (_t, p) => (p === 'onModuleInit' || p === 'onModuleDestroy' || p === '$connect' || p === '$disconnect' ? async () => {} : new Proxy({}, { get: () => async () => null })) });
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(fakePrisma).compile();
    expect(mod.get(AttendanceService)).toBeDefined();
    expect(mod.get(FilesService)).toBeDefined();
    expect(mod.get(ChannelsService)).toBeDefined();
    expect(mod.get(JobsService)).toBeDefined();
    await mod.close();
  });
});
