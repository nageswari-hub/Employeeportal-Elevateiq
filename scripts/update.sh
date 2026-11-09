#!/usr/bin/env bash
# Safe update: backup first, rebuild, restart, verify health. Database migrations run automatically on API start.
set -euo pipefail
cd "$(dirname "$0")/.."
./scripts/backup.sh || { echo "Backup failed - aborting update."; exit 1; }
[ -d .git ] && git pull --ff-only || true
docker compose build
docker compose up -d
for i in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null)" = "healthy" ]; then
    echo "Updated and healthy."; docker image prune -f >/dev/null; exit 0
  fi
  sleep 3
done
echo "API is not healthy after update. Roll back with: git checkout <previous> && docker compose up -d --build"
docker compose logs --tail=50 api
exit 1
