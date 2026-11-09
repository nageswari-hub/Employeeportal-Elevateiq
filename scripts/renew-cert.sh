#!/usr/bin/env bash
# Renews the Let's Encrypt certificate when it has <30 days left. Needs ~10s of downtime (port 80 is borrowed).
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a
CERT="/etc/letsencrypt/live/$APP_DOMAIN/cert.pem"
if openssl x509 -checkend $((30*86400)) -noout -in "$CERT"; then echo "[$(date -Is)] certificate OK, nothing to do"; exit 0; fi
docker compose stop nginx
docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt -v /var/www/certbot:/var/www/certbot \
  certbot/certbot renew --standalone --non-interactive || { docker compose start nginx; exit 1; }
docker compose start nginx
echo "[$(date -Is)] certificate renewed"
