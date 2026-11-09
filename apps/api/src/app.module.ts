import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TeamsModule } from './modules/teams/teams.module';
import { BatchesModule } from './modules/batches/batches.module';
import { GoalsModule } from './modules/goals/goals.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { LearningModule } from './modules/learning/learning.module';
import { ReportsModule } from './modules/reports/reports.module';
import { InsightsModule } from './modules/insights/insights.module';
import { CommsModule } from './modules/comms/comms.module';
import { HealthModule } from './modules/health/health.module';
import { AuditModule } from './modules/audit/audit.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { CommonModule } from './common/common.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { FilesModule } from './modules/files/files.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { AdminModule } from './modules/admin/admin.module';
import { WorkplaceModule } from './modules/workplace/workplace.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }]),
    CommonModule,
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    TeamsModule,
    BatchesModule,
    GoalsModule,
    ProjectsModule,
    TicketsModule,
    TasksModule,
    LearningModule,
    ReportsModule,
    InsightsModule,
    CommsModule,
    HealthModule,
    FilesModule,
    AttendanceModule,
    JobsModule,
    AdminModule,
    WorkplaceModule,
  ],
  providers: [
    // Order matters: authenticate first, then rate-limit per user, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
