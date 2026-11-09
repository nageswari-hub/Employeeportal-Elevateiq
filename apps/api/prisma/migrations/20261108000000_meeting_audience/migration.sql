-- Meeting audience: company / team / team leads / explicit users
ALTER TABLE "meetings"
  ADD COLUMN IF NOT EXISTS "audience" VARCHAR(10) NOT NULL DEFAULT 'TEAM',
  ADD COLUMN IF NOT EXISTS "attendeeIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Existing company-wide meetings (teamId IS NULL) stay company-wide.
UPDATE "meetings" SET "audience" = 'COMPANY' WHERE "teamId" IS NULL AND "audience" = 'TEAM';
