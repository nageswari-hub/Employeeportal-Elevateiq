-- TeamFlow optional performance indexes — NOT a Prisma migration.
-- Apply post-deploy on your VPS (Stage 9) AFTER `prisma migrate deploy`:
--   psql $DATABASE_URL -f apps/api/prisma/optional-search-indexes.sql
-- Safe to re-run (IF NOT EXISTS). Requires pg_trgm (bundled with Postgres 16).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Case-insensitive email dedupe (app already lowercases; this blocks race-case dupes)
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_lower_uniq" ON "users" (LOWER("email"));

-- Dashboard search: task / user / announcement titles
CREATE INDEX IF NOT EXISTS "tasks_title_trgm_idx" ON "tasks" USING gin ("title" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "users_displayname_trgm_idx" ON "users" USING gin ("displayName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "announcements_title_trgm_idx" ON "announcements" USING gin ("title" gin_trgm_ops);

-- Audit purge helper (retain 1yr cron: DELETE FROM "audit_logs" WHERE "createdAt" < now() - interval '1 year')
CREATE INDEX IF NOT EXISTS "audit_logs_createdAt_brin_idx" ON "audit_logs" USING brin ("createdAt");
