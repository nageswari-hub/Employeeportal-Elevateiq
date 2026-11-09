-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "note" TEXT,
ADD COLUMN     "noteUpdatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "noteUpdatedById" TEXT;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_noteUpdatedById_fkey" FOREIGN KEY ("noteUpdatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
