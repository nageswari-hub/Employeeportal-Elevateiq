CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DONE', 'ARCHIVED');

CREATE TABLE "projects" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" TEXT,
  "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
  "teamId" TEXT,
  "batchId" TEXT,
  "ownerId" TEXT,
  "startDate" DATE,
  "dueDate" DATE,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "projects_teamId_status_idx" ON "projects"("teamId", "status");
CREATE INDEX "projects_batchId_idx" ON "projects"("batchId");
CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");

ALTER TABLE "projects" ADD CONSTRAINT "projects_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks" ADD COLUMN "projectId" TEXT;
CREATE INDEX "tasks_projectId_idx" ON "tasks"("projectId");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
