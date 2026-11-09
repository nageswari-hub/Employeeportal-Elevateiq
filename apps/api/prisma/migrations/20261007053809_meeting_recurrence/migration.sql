-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "recurrence" VARCHAR(10) NOT NULL DEFAULT 'NONE';
