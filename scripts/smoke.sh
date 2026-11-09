#!/usr/bin/env bash
# Post-deploy smoke test: health -> login -> upload a file -> download it back (through Nginx) -> compare -> clean up.
# Proves the whole chain works, including the X-Accel file delivery. Needs ADMIN_EMAIL / ADMIN_PASSWORD (or pass your own).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; source .env; set +a; }
BASE="${1:-https://${APP_DOMAIN:?}}"
EMAIL="${SMOKE_EMAIL:-${ADMIN_EMAIL:?}}"
PASS="${SMOKE_PASSWORD:-${ADMIN_PASSWORD:?}}"
JAR="$(mktemp)"; TMP="$(mktemp)"; trap 'rm -f "$JAR" "$TMP" "$TMP.dl"' EXIT
ok() { echo "  ✓ $*"; }; die() { echo "  ✗ $*"; exit 1; }

curl -fsS "$BASE/api/healthz" | grep -q '"db":"up"' && ok "health: database up" || die "health check failed"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -c "$JAR" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" "$BASE/backend/auth/login")
[ "$CODE" = 200 ] && ok "login" || die "login returned $CODE (if this is the first run you must change the temporary password in the app first, or set SMOKE_EMAIL/SMOKE_PASSWORD)"

head -c 300000 /dev/urandom > "$TMP"
RESP=$(curl -fsS -b "$JAR" -H 'Content-Type: application/octet-stream' --data-binary @"$TMP" "$BASE/backend/files?context=ANNOUNCEMENT&name=smoke-test.bin") || die "upload failed"
ID=$(echo "$RESP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p'); [ -n "$ID" ] && ok "upload (id $ID)" || die "no file id in response: $RESP"

curl -fsS -b "$JAR" -D "$TMP.h" -o "$TMP.dl" "$BASE/backend/files/$ID" || die "download failed"
cmp -s "$TMP" "$TMP.dl" && ok "download matches upload byte-for-byte" || die "downloaded bytes differ"
grep -qi 'content-disposition: attachment' "$TMP.h" && ok "served as a forced download" || die "missing attachment header"
grep -qi 'x-content-type-options: nosniff' "$TMP.h" && ok "nosniff header present" || die "nosniff missing"
curl -fsS -b "$JAR" -X DELETE -H "Origin: $BASE" "$BASE/backend/files/$ID" >/dev/null && ok "cleanup" || true
rm -f "$TMP.h"
echo "Smoke test passed."
