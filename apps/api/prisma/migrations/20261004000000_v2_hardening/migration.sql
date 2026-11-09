-- New notification kinds (admin password-reset requests, attention radar, system messages)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PASSWORD_RESET_REQUEST';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ATTENTION';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TASK_COMMENT';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'SYSTEM';

-- NOTE: Prisma cannot express this partial/expression index; `migrate deploy` (production) is unaffected,
-- but `migrate dev` may offer to drop it. Keep it.
-- Company-wide channels have NULL teamId, which the existing unique index treats as always distinct.
-- Remove duplicates first (keep the oldest), then enforce uniqueness by case-insensitive name.
DELETE FROM "channels" c USING "channels" d
WHERE c."teamId" IS NULL AND d."teamId" IS NULL AND lower(c."name") = lower(d."name") AND (c."createdAt", c."id") > (d."createdAt", d."id");
CREATE UNIQUE INDEX IF NOT EXISTS "channels_company_name_uniq" ON "channels" (lower("name")) WHERE "teamId" IS NULL;

-- Hot-path indexes (Prisma default names so `prisma migrate dev` does not see drift)
CREATE INDEX IF NOT EXISTS "tasks_teamId_status_dueDate_idx" ON "tasks" ("teamId", "status", "dueDate");
CREATE INDEX IF NOT EXISTS "notifications_isRead_createdAt_idx" ON "notifications" ("isRead", "createdAt");
