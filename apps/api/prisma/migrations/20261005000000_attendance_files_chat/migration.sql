-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'HALF_DAY', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('OFFICE', 'REMOTE');

-- CreateEnum
CREATE TYPE "BreakReason" AS ENUM ('LUNCH', 'TEA', 'PERSONAL', 'OTHER');

-- CreateEnum
CREATE TYPE "FileContext" AS ENUM ('AVATAR', 'TASK', 'COMMENT', 'CHANNEL', 'REPORT', 'ANNOUNCEMENT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE';

-- DropForeignKey
ALTER TABLE "task_attachments" DROP CONSTRAINT "task_attachments_taskId_fkey";

-- DropForeignKey
ALTER TABLE "task_attachments" DROP CONSTRAINT "task_attachments_uploadedById_fkey";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatarFileId" TEXT,
ADD COLUMN     "deactivatedAt" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "channel_messages" ADD COLUMN     "clientId" VARCHAR(40),
ADD COLUMN     "deletedAt" TIMESTAMPTZ(6);

-- DropTable
DROP TABLE "task_attachments";

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "context" "FileContext" NOT NULL,
    "scopeId" TEXT,
    "name" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(120) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "storageKey" VARCHAR(200) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "taskId" TEXT,
    "commentId" TEXT,
    "messageId" TEXT,
    "reportId" TEXT,
    "announcementId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_days" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "teamId" TEXT,
    "batchId" TEXT,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "mode" "WorkMode" NOT NULL DEFAULT 'OFFICE',
    "checkInAt" TIMESTAMPTZ(6),
    "checkOutAt" TIMESTAMPTZ(6),
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" VARCHAR(500),
    "checkOutNote" VARCHAR(500),
    "autoClosed" BOOLEAN NOT NULL DEFAULT false,
    "editedById" TEXT,
    "editReason" VARCHAR(500),
    "checkInIp" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_logs" (
    "id" TEXT NOT NULL,
    "attendanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" "BreakReason" NOT NULL DEFAULT 'PERSONAL',
    "note" VARCHAR(300),
    "startAt" TIMESTAMPTZ(6) NOT NULL,
    "endAt" TIMESTAMPTZ(6),
    "autoEnded" BOOLEAN NOT NULL DEFAULT false,
    "overNotified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "break_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_reads" (
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_reads_pkey" PRIMARY KEY ("userId","channelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "files_storageKey_key" ON "files"("storageKey");

-- CreateIndex
CREATE INDEX "files_taskId_idx" ON "files"("taskId");

-- CreateIndex
CREATE INDEX "files_commentId_idx" ON "files"("commentId");

-- CreateIndex
CREATE INDEX "files_messageId_idx" ON "files"("messageId");

-- CreateIndex
CREATE INDEX "files_reportId_idx" ON "files"("reportId");

-- CreateIndex
CREATE INDEX "files_announcementId_idx" ON "files"("announcementId");

-- CreateIndex
CREATE INDEX "files_uploaderId_createdAt_idx" ON "files"("uploaderId", "createdAt");

-- CreateIndex
CREATE INDEX "files_context_createdAt_idx" ON "files"("context", "createdAt");

-- CreateIndex
CREATE INDEX "attendance_days_day_teamId_idx" ON "attendance_days"("day", "teamId");

-- CreateIndex
CREATE INDEX "attendance_days_day_status_idx" ON "attendance_days"("day", "status");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_days_userId_day_key" ON "attendance_days"("userId", "day");

-- CreateIndex
CREATE INDEX "break_logs_attendanceId_idx" ON "break_logs"("attendanceId");

-- CreateIndex
CREATE INDEX "break_logs_userId_startAt_idx" ON "break_logs"("userId", "startAt");

-- CreateIndex
CREATE INDEX "break_logs_endAt_idx" ON "break_logs"("endAt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_messages_authorId_clientId_key" ON "channel_messages"("authorId", "clientId");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "task_comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "channel_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "daily_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_logs" ADD CONSTRAINT "break_logs_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendance_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_logs" ADD CONSTRAINT "break_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_reads" ADD CONSTRAINT "channel_reads_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Keep deactivated people in historical attendance: stamp existing inactive users
UPDATE "users" SET "deactivatedAt" = "updatedAt" WHERE "isActive" = false AND "deactivatedAt" IS NULL;
