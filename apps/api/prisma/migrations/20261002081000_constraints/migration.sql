-- TeamFlow Stage 2: business-rule CHECKs (DB last line of defence).
-- NOTE: Search indexes (pg_trgm/GIN) are intentionally NOT in this Prisma migration
-- because Prisma would see them as drift and generate DROP INDEX.
-- They live in prisma/optional-search-indexes.sql and are applied post-deploy (Stage 9).

-- 1. Email sanity (app lowercases before save; DB enforces basic format)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_email_format_chk') THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_email_format_chk" CHECK ("email" LIKE '%@%.%');
  END IF;
END $$;

-- 2. Batches: end >= start, sane duration
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batches_dates_chk') THEN
    ALTER TABLE "batches" ADD CONSTRAINT "batches_dates_chk" CHECK ("endDate" >= "startDate");
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batches_duration_chk') THEN
    ALTER TABLE "batches" ADD CONSTRAINT "batches_duration_chk" CHECK ("durationDays" > 0 AND "durationDays" <= 365);
  END IF;
END $$;

-- 4. Tasks: BLOCKED requires reason, hours >= 0, titles non-empty
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_blocked_reason_chk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_blocked_reason_chk"
      CHECK ("status" <> 'BLOCKED'::"TaskStatus" OR ("blockedReason" IS NOT NULL AND length(btrim("blockedReason")) > 0));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_hours_chk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_hours_chk" CHECK ("estimatedHours" IS NULL OR "estimatedHours" >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tasks_title_chk') THEN
    ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_chk" CHECK (length(btrim("title")) > 0);
  END IF;
END $$;

-- 5. Daily reports: hours 0-24, bodies non-empty
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_reports_hours_chk') THEN
    ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_hours_chk" CHECK ("hoursWorked" >= 0 AND "hoursWorked" <= 24);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_reports_body_chk') THEN
    ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_body_chk"
      CHECK (length(btrim("didToday")) > 0 AND length(btrim("planTomorrow")) > 0);
  END IF;
END $$;

-- 6. Attachments: 1 byte .. 10 MB (app also checks MIME allowlist)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'task_attachments_size_chk') THEN
    ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_size_chk"
      CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760);
  END IF;
END $$;

-- 8. Assessments / questions sanity
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessments_maxscore_chk') THEN
    ALTER TABLE "assessments" ADD CONSTRAINT "assessments_maxscore_chk" CHECK ("maxScore" > 0 AND "maxScore" <= 1000);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assessment_questions_points_chk') THEN
    ALTER TABLE "assessment_questions" ADD CONSTRAINT "assessment_questions_points_chk" CHECK ("points" > 0 AND "points" <= 100);
  END IF;
END $$;

-- 9. Training items: day > 0
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_items_day_chk') THEN
    ALTER TABLE "training_items" ADD CONSTRAINT "training_items_day_chk" CHECK ("dayNumber" > 0 AND "dayNumber" <= 365);
  END IF;
END $$;

-- 10. Evaluations: percentages 0-100
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'batch_evaluations_pct_chk') THEN
    ALTER TABLE "batch_evaluations" ADD CONSTRAINT "batch_evaluations_pct_chk"
      CHECK (
        ("attendancePct" IS NULL OR ("attendancePct" >= 0 AND "attendancePct" <= 100)) AND
        ("taskCompletionPct" IS NULL OR ("taskCompletionPct" >= 0 AND "taskCompletionPct" <= 100)) AND
        ("avgScore" IS NULL OR ("avgScore" >= 0 AND "avgScore" <= 100))
      );
  END IF;
END $$;
-- End of CHECKs. See prisma/optional-search-indexes.sql for optional GIN/BRIN indexes.
