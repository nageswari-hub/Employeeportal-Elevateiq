ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TICKET';

CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "TicketCategory" AS ENUM ('WORK', 'ACCESS', 'ATTENDANCE', 'TECHNICAL', 'OTHER');

CREATE TABLE "tickets" (
  "id" TEXT NOT NULL,
  "subject" VARCHAR(200) NOT NULL,
  "description" TEXT NOT NULL,
  "category" "TicketCategory" NOT NULL DEFAULT 'OTHER',
  "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "escalated" BOOLEAN NOT NULL DEFAULT false,
  "requesterId" TEXT NOT NULL,
  "assigneeId" TEXT,
  "teamId" TEXT,
  "resolution" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tickets_status_createdAt_idx" ON "tickets"("status", "createdAt");
CREATE INDEX "tickets_requesterId_idx" ON "tickets"("requesterId");
CREATE INDEX "tickets_assigneeId_idx" ON "tickets"("assigneeId");
CREATE INDEX "tickets_teamId_idx" ON "tickets"("teamId");

ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requesterId_fkey"
  FOREIGN KEY ("requesterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ticket_messages" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_messages_ticketId_createdAt_idx" ON "ticket_messages"("ticketId", "createdAt");

ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
