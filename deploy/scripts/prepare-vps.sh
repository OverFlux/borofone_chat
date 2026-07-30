#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: sudo bash deploy/scripts/prepare-vps.sh <talk.example.com> <admin-email>" >&2
  exit 1
fi
if [ "$(id -u)" -ne 0 ]; then
  echo "run this script with sudo" >&2
  exit 1
fi

domain="$1"
admin_email="$2"
turn_domain="turn.${domain}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if ! [[ "${domain}" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
  echo "invalid domain: ${domain}" >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl docker.io nginx certbot openssl rclone ufw
if ! DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-v2; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose
fi
systemctl enable --now docker

systemctl stop nginx || true
certbot certonly --standalone \
  --non-interactive --agree-tos \
  --email "${admin_email}" \
  -d "${domain}"
certbot certonly --standalone \
  --non-interactive --agree-tos \
  --email "${admin_email}" \
  -d "${turn_domain}"

sed "s/__BOROTALK_DOMAIN__/${domain}/g" \
  "${repo_root}/deploy/nginx/borofone.conf" \
  > /etc/nginx/sites-available/borotalk
ln -sfn /etc/nginx/sites-available/borotalk /etc/nginx/sites-enabled/borotalk
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx

ssh_port="${BOROTALK_SSH_PORT:-22}"
if ! [[ "${ssh_port}" =~ ^[0-9]+$ ]] || [ "${ssh_port}" -lt 1 ] || [ "${ssh_port}" -gt 65535 ]; then
  echo "invalid BOROTALK_SSH_PORT: ${ssh_port}" >&2
  exit 1
fi
ufw allow "${ssh_port}/tcp"
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49160:49260/udp
ufw --force enable

if [ ! -f "${repo_root}/.env" ]; then
  external_ip="$(curl -fsS --ipv4 https://api.ipify.org)"
  db_password="$(openssl rand -hex 24)"
  jwt_secret="$(openssl rand -hex 48)"
  turn_secret="$(openssl rand -hex 48)"
  webhook_secret="$(openssl rand -hex 32)"
  sed \
    -e "s#talk.example.com#${domain}#g" \
    -e "s#owner@example.com#${admin_email}#g" \
    -e "s#203.0.113.10#${external_ip}#g" \
    -e "s#change-me-to-a-long-random-string#${jwt_secret}#" \
    -e "0,/change-me/{s/change-me/${db_password}/}" \
    "${repo_root}/deploy/env/.env.production.example" \
    > "${repo_root}/.env"
  sed -i "s#POSTGRES_PASSWORD=change-me#POSTGRES_PASSWORD=${db_password}#" "${repo_root}/.env"
  sed -i "s#TURN_SHARED_SECRET=.*#TURN_SHARED_SECRET=${turn_secret}#" "${repo_root}/.env"
  sed -i "s#TELEGRAM_WEBHOOK_SECRET=.*#TELEGRAM_WEBHOOK_SECRET=${webhook_secret}#" "${repo_root}/.env"
  chmod 600 "${repo_root}/.env"
fi

install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/borotalk <<EOF
#!/usr/bin/env bash
systemctl reload nginx
cd "${repo_root}"
if docker compose version >/dev/null 2>&1; then
  docker compose -p borofone-prod -f deploy/docker/docker-compose.prod.yml restart coturn
else
  docker-compose -p borofone-prod -f deploy/docker/docker-compose.prod.yml restart coturn
fi
EOF
chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/borotalk

cat > /etc/systemd/system/borotalk-health.service <<EOF
[Unit]
Description=Borotalk VPS health check
After=docker.service nginx.service

[Service]
Type=oneshot
ExecStart=/usr/bin/bash ${repo_root}/deploy/scripts/check-vps-health.sh ${domain}
EOF

cat > /etc/systemd/system/borotalk-health.timer <<'EOF'
[Unit]
Description=Run Borotalk VPS health check every five minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/borotalk-backup.service <<EOF
[Unit]
Description=Back up Borotalk PostgreSQL and uploads
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/bash ${repo_root}/deploy/scripts/backup-compose-data.sh production borofone-prod deploy/docker/docker-compose.prod.yml borofone_prod borofone-prod_uploads_data
EOF

cat > /etc/systemd/system/borotalk-backup.timer <<'EOF'
[Unit]
Description=Back up Borotalk every day

[Timer]
OnCalendar=daily
RandomizedDelaySec=20min
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat > /etc/systemd/system/borotalk-restore-check.service <<EOF
[Unit]
Description=Verify the latest Borotalk backup can be restored
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/bash ${repo_root}/deploy/scripts/verify-latest-backup.sh production
EOF

cat > /etc/systemd/system/borotalk-restore-check.timer <<'EOF'
[Unit]
Description=Run a Borotalk restore drill every week

[Timer]
OnCalendar=weekly
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now borotalk-health.timer borotalk-backup.timer borotalk-restore-check.timer

echo
echo "VPS prepared for https://${domain}"
echo "Before deployment, edit ${repo_root}/.env and replace SMTP_* and TELEGRAM_BOT_* placeholders."
echo "Then run: bash deploy/scripts/deploy-stack.sh production"
