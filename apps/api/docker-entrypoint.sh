#!/bin/sh
set -e
# Apply pending Prisma migrations, then start the API.
# prisma CLI ships in production deps intentionally for this step.
npx prisma migrate deploy
exec node dist/main
