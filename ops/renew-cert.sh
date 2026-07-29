#!/bin/sh
# Renews the kerektap.kz certificate. Uses a TLS-ALPN-01 challenge on :443
# because port 80 belongs to another project on this box, so nginx has to
# release :443 for the duration of the check — hence the stop/start around
# acme.sh rather than a plain --reloadcmd.
#
# acme.sh exits 0 and does nothing when the cert isn't due yet, so running
# this daily is safe. nginx is restarted unconditionally (even on failure)
# so a failed renewal can never leave the site down.
set -e
LOG=/home/artur/acme/renew.log
echo "=== $(date -Is) renewal check ===" >> "$LOG"

docker stop aggregator_nginx_1 >> "$LOG" 2>&1 || true
docker run --rm -p 443:443 \
  -v /home/artur/acme:/acme.sh \
  neilpang/acme.sh --cron >> "$LOG" 2>&1 || echo "acme.sh cron returned non-zero" >> "$LOG"
docker start aggregator_nginx_1 >> "$LOG" 2>&1 || true

# Copy whatever acme.sh currently holds into the directory nginx mounts, then
# reload so a fresh cert is picked up without a restart.
docker run --rm \
  -v /home/artur/acme:/acme.sh \
  -v /home/artur/aggregator/nginx/certs:/certs \
  neilpang/acme.sh --install-cert -d kerektap.kz --ecc \
  --fullchain-file /certs/fullchain.pem --key-file /certs/privkey.pem >> "$LOG" 2>&1 || true
docker exec aggregator_nginx_1 nginx -s reload >> "$LOG" 2>&1 || true

echo "=== $(date -Is) done ===" >> "$LOG"
