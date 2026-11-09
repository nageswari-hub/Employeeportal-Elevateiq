#!/usr/bin/env bash
# TeamFlow nightly backup: pg_dump (custom format, compressed) -> verify -> rotate -> optional off-site copy -> alert on failure.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
[ -f .env ] && { set -a; source .env; set +a; }

notify_fail() {
  echo "[$(date -Is)] BACKUP FAILED" >&2
  [ -n "${ALERT_WEBHOOK_URL:-}" ] && curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"text\":\"TeamFlow backup FAILED on $(hostname) at $(date -Is)\",\"content\":\"TeamFlow backup FAILED on $(hostname)\"}" "$ALERT_WEBHOOK_URL" >/dev/null || true
}
trap notify_fail ERR

BACKUP_DIR="${BACKUP_DIR:-/var/backups/teamflow}"
KEEP="${BACKUP_KEEP_DAILY:-14}"
DATE="$(date +%F)"
DEST="$BACKUP_DIR/teamflow-$DATE.dump.gz"
DC="docker compose -f $ROOT/docker-compose.yml"

mkdir -p "$BACKUP_DIR"
echo "[$(date -Is)] backup start -> $DEST"
$DC exec -T postgres pg_dump -U "${POSTGRES_USER:?}" -d "${POSTGRES_DB:?}" -Fc | gzip > "$DEST.tmp"

# A tiny file means the dump silently failed.
[ "$(stat -c %s "$DEST.tmp")" -gt 2048 ] || { echo "dump suspiciously small"; exit 1; }
gunzip -c "$DEST.tmp" | $DC exec -T postgres pg_restore --list > /dev/null     # catches corruption/truncation
mv "$DEST.tmp" "$DEST"
chmod 600 "$DEST"
find "$BACKUP_DIR" -name 'teamflow-*.dump.gz' -mtime +"$KEEP" -delete || true

# Uploaded files (incremental: only new files are copied; deleted files are kept in the backup on purpose)
VOL="$(docker volume inspect -f '{{.Mountpoint}}' teamflow_uploads 2>/dev/null || true)"
if [ -n "$VOL" ] && [ -d "$VOL" ]; then
  mkdir -p "$BACKUP_DIR/uploads"
  if command -v rsync >/dev/null; then rsync -a --exclude tmp "$VOL"/ "$BACKUP_DIR/uploads"/; else cp -a -u "$VOL"/. "$BACKUP_DIR/uploads"/; fi
  echo "[$(date -Is)] uploads backed up ($(du -sh "$BACKUP_DIR/uploads" | cut -f1))"
else
  echo "WARNING: could not locate the uploads volume; files were NOT backed up."
fi

# Off-site copy: a backup on the same disk is not a backup.
if [ -n "${OFFSITE_RSYNC_TARGET:-}" ]; then
  rsync -a --delete-after "$BACKUP_DIR"/ "$OFFSITE_RSYNC_TARGET"/
elif [ -n "${OFFSITE_RCLONE_REMOTE:-}" ]; then
  rclone copy "$BACKUP_DIR" "$OFFSITE_RCLONE_REMOTE" --max-age "${KEEP}d"
else
  echo "WARNING: no OFFSITE_* target configured - backups exist only on this server."
fi
echo "[$(date -Is)] backup OK: $(du -h "$DEST" | cut -f1), keeping $KEEP days"
