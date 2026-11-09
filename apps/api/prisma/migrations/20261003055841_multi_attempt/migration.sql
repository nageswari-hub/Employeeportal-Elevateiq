-- DropIndex
DROP INDEX "assessment_attempts_assessmentId_userId_key";

-- CreateIndex
CREATE INDEX "assessment_attempts_assessmentId_userId_idx" ON "assessment_attempts"("assessmentId", "userId");
