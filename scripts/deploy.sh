#!/usr/bin/env bash
# One-command first deployment on a fresh Ubuntu/Debian VPS (needs Docker + Docker Compose plugin, root or sudo).
#   1. Point your domain's DNS A record at this server.
#   2. ./scripts/deploy.sh
# Generates strong secrets, gets a free TLS certificate, builds, starts, creates the admin and schedules backups.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

command -v docker >/dev/null || { echo "Docker is not installed. See https://docs.docker.com/engine/install/"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin is missing."; exit 1; }

setenv() { # setenv KEY VALUE  (values are hex/alnum/domain-safe, so | is a safe sed delimiter)
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else echo "$1=$2" >> .env; fi
}

if [ ! -f .env ]; then
  read -rp "Domain name (its DNS must already point to this server): " DOMAIN
  read -rp "Email for certificate expiry notices: " LE_EMAIL
  read -rp "Admin login email: " ADMIN_EMAIL
  cp .env.example .env
  ADMIN_PASSWORD="$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 12)7x"
  setenv APP_DOMAIN "$DOMAIN"
  setenv LETSENCRYPT_EMAIL "$LE_EMAIL"
  setenv ADMIN_EMAIL "$ADMIN_EMAIL"
  setenv ADMIN_PASSWORD "$ADMIN_PASSWORD"
  setenv POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  setenv JWT_ACCESS_SECRET "$(openssl rand -hex 32)"
  chmod 600 .env
  echo; echo ">>> Temporary admin password (shown once, you must change it at first login): $ADMIN_PASSWORD"; echo
fi

set -a; source .env; set +a
: "${APP_DOMAIN:?}"; : "${LETSENCRYPT_EMAIL:?}"

mkdir -p /var/www/certbot "${BACKUP_DIR:-/var/backups/teamflow}"

if [ ! -f "/etc/letsencrypt/live/$APP_DOMAIN/fullchain.pem" ]; then
  echo "Requesting TLS certificate for $APP_DOMAIN (port 80 must be free and DNS must point here)..."
  docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt -v /var/www/certbot:/var/www/certbot \
    certbot/certbot certonly --standalone -d "$APP_DOMAIN" --email "$LETSENCRYPT_EMAIL" \
    --agree-tos --no-eff-email --non-interactive
fi

echo "Building and starting TeamFlow..."
docker compose up -d --build

echo "Waiting for the API to become healthy..."
for i in $(seq 1 60); do
  if [ "$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q api)" 2>/dev/null)" = "healthy" ]; then break; fi
  sleep 3
  [ "$i" = 60 ] && { echo "API did not become healthy. Check: docker compose logs api"; exit 1; }
done

docker compose exec -T api node dist/seed.js

# Scheduled jobs (backup nightly 02:00, certificate check weekly) — only if running as root
if [ "$(id -u)" = "0" ]; then
  cat > /etc/cron.d/teamflow <<CRON
0 2 * * * root cd $ROOT && ./scripts/backup.sh >> /var/log/teamflow-backup.log 2>&1
30 3 * * 0 root cd $ROOT && ./scripts/renew-cert.sh >> /var/log/teamflow-cert.log 2>&1
CRON
  echo "Cron jobs installed (/etc/cron.d/teamflow)."
else
  echo "Not root: add the backup and renew-cert cron jobs yourself (see docs/deploy.md)."
fi

echo; echo "Done. Open https://$APP_DOMAIN and sign in as $ADMIN_EMAIL"
