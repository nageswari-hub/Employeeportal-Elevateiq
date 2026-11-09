-- Channel types: company / team / batch / private group / direct message
CREATE TYPE "channel_type" AS ENUM ('COMPANY', 'TEAM', 'BATCH', 'GROUP', 'DM');

ALTER TABLE "channels"
  ADD COLUMN "type" "channel_type" NOT NULL DEFAULT 'TEAM',
  ADD COLUMN "batchId" TEXT;

-- Existing company channels (no team) become COMPANY, the rest stay TEAM.
UPDATE "channels" SET "type" = 'COMPANY' WHERE "teamId" IS NULL;

CREATE INDEX "channels_batchId_idx" ON "channels"("batchId");
CREATE UNIQUE INDEX "channels_batchId_name_key" ON "channels"("batchId", "name");
CREATE INDEX "channels_type_idx" ON "channels"("type");

ALTER TABLE "channels" ADD CONSTRAINT "channels_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "channel_members" (
  "channelId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "channel_members_pkey" PRIMARY KEY ("channelId", "userId")
);

CREATE INDEX "channel_members_userId_idx" ON "channel_members"("userId");

ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_channelId_fkey"
  FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "channel_members" ADD CONSTRAINT "channel_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
