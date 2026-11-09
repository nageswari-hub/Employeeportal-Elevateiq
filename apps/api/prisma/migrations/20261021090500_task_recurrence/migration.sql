ALTER TABLE "tasks"
  ADD COLUMN "recurrence" VARCHAR(10) NOT NULL DEFAULT 'NONE',
  ADD COLUMN "recurrenceUntil" DATE,
  ADD COLUMN "seriesId" TEXT;

CREATE INDEX "tasks_seriesId_idx" ON "tasks"("seriesId");
