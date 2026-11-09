#!/usr/bin/env bash
# Restore DRILL: loads a backup into a throwaway database, counts tables/rows, then drops it. Never touches production data.
# Usage: ./scripts/restore.sh /var/backups/teamflow/teamflow-2026-10-04.dump.gz
# (To really restore production, stop the api, drop/recreate the database, then pg_restore into it - see docs/deploy.md.)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; source .env; set +a; }
FILE="${1:?usage: restore.sh <backup.dump.gz>}"
TMPDB="restore_drill_$$"
DC="docker compose -f $(pwd)/docker-compose.yml exec -T postgres"
cleanup() { $DC psql -U "${POSTGRES_USER:?}" -d postgres -c "DROP DATABASE IF EXISTS $TMPDB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT
echo "Restoring $FILE into throwaway db $TMPDB ..."
$DC psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE $TMPDB;" >/dev/null
gunzip -c "$FILE" | $DC pg_restore -U "$POSTGRES_USER" -d "$TMPDB" --no-owner >/dev/null
echo "Tables restored: $($DC psql -U "$POSTGRES_USER" -d "$TMPDB" -tAc "SELECT count(*) FROM pg_tables WHERE schemaname='public';")"
echo "Users in backup: $($DC psql -U "$POSTGRES_USER" -d "$TMPDB" -tAc 'SELECT count(*) FROM users;')"
echo "Tasks in backup: $($DC psql -U "$POSTGRES_USER" -d "$TMPDB" -tAc 'SELECT count(*) FROM tasks;')"
echo "DRILL OK (throwaway db dropped, production untouched)"
