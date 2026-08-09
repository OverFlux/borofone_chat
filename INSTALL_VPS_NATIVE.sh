#!/usr/bin/env bash
set -euo pipefail

readonly INSTALL_DIR="${BOROTALK_INSTALL_DIR:-/opt/borotalk}"
readonly ENV_DIR="/etc/borotalk"
readonly ENV_FILE="${ENV_DIR}/borotalk.env"
readonly DATA_ROOT="/var/lib/borotalk"
readonly BACKUP_ROOT="/var/backups/borotalk"
readonly CERTBOT_VENV="/opt/borotalk-certbot"
readonly REPOSITORY="${BOROTALK_REPO_URL:-https://github.com/OverFlux/borofone_chat.git}"
readonly RELEASE_REF="${BOROTALK_RELEASE_REF:-main}"
readonly PROTECTED_SERVICES=(x-ui.service callsnif.service vpn-misa-bot.service)
readonly BOROTALK_SERVICES=(
  borotalk-api.service
  borotalk-worker.service
  borotalk-redis.service
  borotalk-nginx.service
  borotalk-turn.service
  borotalk-turn-udp443.service
)

mode="${1:-install}"

log() { printf '\n[Borotalk native] %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

require_root() {
  [ "$(id -u)" -eq 0 ] || die "Run this installer as root."
  command -v apt-get >/dev/null 2>&1 || die "Ubuntu/Debian with apt is required."
}

free_disk_kb() { df -Pk / | awk 'NR==2 {print $4}'; }

require_disk() {
  local minimum_kb="$1"
  local available_kb
  available_kb="$(free_disk_kb)"
  [ "${available_kb:-0}" -ge "${minimum_kb}" ] \
    || die "Not enough disk space: $((available_kb / 1024)) MiB available."
}

require_snapshot() {
  if [ "${BOROTALK_SNAPSHOT_CONFIRMED:-}" = "YES" ]; then
    return
  fi
  [ -t 0 ] || die "Create a full VPS snapshot, then rerun with BOROTALK_SNAPSHOT_CONFIRMED=YES."
  printf '\nCreate a full VPS snapshot before continuing.\n'
  read -r -p 'Type SNAPSHOT after it is ready: ' answer
  [ "${answer}" = "SNAPSHOT" ] || die "Installation cancelled before making changes."
}

public_ipv4() {
  curl --fail --silent --show-error --ipv4 --max-time 15 https://api.ipify.org
}

is_ipv4() {
  local value="$1"
  [[ "${value}" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local part
  IFS=. read -r -a parts <<< "${value}"
  for part in "${parts[@]}"; do
    [ "${part}" -le 255 ] || return 1
  done
}

is_domain() {
  [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$ ]]
}

prompt_value() {
  local variable="$1" label="$2" default_value="${3:-}" secret="${4:-0}" answer=""
  local current_value="${!variable-}"
  if [ -n "${current_value}" ]; then
    return
  fi
  [ -t 0 ] || die "Missing ${variable}. Pass it as an environment variable."
  if [ "${secret}" = "1" ]; then
    read -r -s -p "${label}: " answer
    printf '\n'
  elif [ -n "${default_value}" ]; then
    read -r -p "${label} [${default_value}]: " answer
    answer="${answer:-${default_value}}"
  else
    read -r -p "${label}: " answer
  fi
  [ -n "${answer}" ] || die "${label} cannot be empty."
  [[ "${answer}" != *$'\n'* && "${answer}" != *$'\r'* ]] || die "Invalid newline in ${label}."
  printf -v "${variable}" '%s' "${answer}"
}

service_exists() { systemctl cat "$1" >/dev/null 2>&1; }

record_baseline() {
  install -d -m 0750 "${DATA_ROOT}"
  : > "${DATA_ROOT}/preinstall-baseline.txt"
  for service in "${PROTECTED_SERVICES[@]}"; do
    if service_exists "${service}"; then
      printf '%s|%s|%s\n' \
        "${service}" \
        "$(systemctl is-active "${service}" 2>/dev/null || true)" \
        "$(systemctl show "${service}" -p ActiveEnterTimestampMonotonic --value 2>/dev/null || true)" \
        >> "${DATA_ROOT}/preinstall-baseline.txt"
    fi
  done
  ss -H -lntup > "${DATA_ROOT}/preinstall-listeners.txt" || true
}

assert_protected_services() {
  local service expected_state expected_started current_state current_started
  [ -f "${DATA_ROOT}/preinstall-baseline.txt" ] || return 0
  while IFS='|' read -r service expected_state expected_started; do
    [ -n "${service}" ] || continue
    current_state="$(systemctl is-active "${service}" 2>/dev/null || true)"
    current_started="$(systemctl show "${service}" -p ActiveEnterTimestampMonotonic --value 2>/dev/null || true)"
    [ "${current_state}" = "${expected_state}" ] \
      || die "Protected service ${service} changed state (${expected_state} -> ${current_state})."
    if [ "${expected_state}" = "active" ] && [ "${current_started}" != "${expected_started}" ]; then
      die "Protected service ${service} was restarted."
    fi
  done < "${DATA_ROOT}/preinstall-baseline.txt"
}

stop_borotalk_only() {
  systemctl disable --now "${BOROTALK_SERVICES[@]}" >/dev/null 2>&1 || true
}

on_install_error() {
  printf '\nInstallation failed. Only Borotalk services are being stopped; VPN and bots are untouched.\n' >&2
  stop_borotalk_only
}

port_is_free() {
  local protocol="$1" port="$2"
  if [ "${protocol}" = "tcp" ]; then
    if ss -H -lnt "sport = :${port}" | grep -q .; then
      return 1
    fi
  else
    if ss -H -lnu "sport = :${port}" | grep -q .; then
      return 1
    fi
  fi
  return 0
}

check_required_ports() {
  local entry protocol port
  for entry in tcp:80 tcp:443 udp:443 tcp:3478 udp:3478 tcp:5349; do
    protocol="${entry%%:*}"
    port="${entry##*:}"
    port_is_free "${protocol}" "${port}" || die "${protocol^^} port ${port} is already in use."
  done
}

install_source() {
  if [ -f "${INSTALL_DIR}/.borotalk-native-bundled-source" ]; then
    [ -f "${INSTALL_DIR}/app/main.py" ] || die "Bundled Borotalk source is incomplete."
  elif [ -d "${INSTALL_DIR}/.git" ]; then
    [ -z "$(git -C "${INSTALL_DIR}" status --porcelain)" ] \
      || die "${INSTALL_DIR} has uncommitted changes."
    git -C "${INSTALL_DIR}" fetch --tags --prune origin
    git -C "${INSTALL_DIR}" checkout --detach "${RELEASE_REF}"
  elif [ -e "${INSTALL_DIR}" ]; then
    die "${INSTALL_DIR} exists but is not a Borotalk Git checkout."
  else
    git clone --filter=blob:none "${REPOSITORY}" "${INSTALL_DIR}"
    git -C "${INSTALL_DIR}" checkout --detach "${RELEASE_REF}"
  fi
  chown -R root:borotalk "${INSTALL_DIR}"
  chmod -R g+rX,o-rwx "${INSTALL_DIR}"
}

install_packages() {
  local redis_preexisting=0 coturn_preexisting=0 nginx_preexisting=0
  local package_ownership_marker="${DATA_ROOT}/native-packages-authorized"
  dpkg-query -W redis-server >/dev/null 2>&1 && redis_preexisting=1
  dpkg-query -W coturn >/dev/null 2>&1 && coturn_preexisting=1
  dpkg-query -W nginx >/dev/null 2>&1 && nginx_preexisting=1
  if [ ! -f "${package_ownership_marker}" ] && [ ! -f "${DATA_ROOT}/native-packages-installed" ]; then
    [ "${redis_preexisting}" -eq 0 ] || die "A system Redis package already exists; refusing to alter it."
    [ "${coturn_preexisting}" -eq 0 ] || die "A system coturn package already exists; refusing to alter it."
  fi

  # Record ownership before apt so an interrupted first run can safely resume.
  touch "${package_ownership_marker}"

  export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l
  apt-get update
  apt-get install -y \
    ca-certificates curl git openssl nginx postgresql redis-server coturn \
    python3 python3-venv python3-pip build-essential libpq-dev

  systemctl disable --now redis-server.service coturn.service >/dev/null 2>&1 || true
  if [ "${nginx_preexisting}" -eq 0 ]; then
    systemctl disable --now nginx.service >/dev/null 2>&1 || true
  fi
  touch "${DATA_ROOT}/native-packages-installed"
  assert_protected_services
}

ensure_users_and_directories() {
  getent group borotalk >/dev/null || groupadd --system borotalk
  id borotalk >/dev/null 2>&1 \
    || useradd --system --gid borotalk --home-dir "${DATA_ROOT}" --shell /usr/sbin/nologin borotalk
  usermod -a -G borotalk redis
  install -d -m 0750 -o root -g borotalk "${ENV_DIR}" "${BACKUP_ROOT}"
  chown root:borotalk "${DATA_ROOT}"
  chmod 0750 "${DATA_ROOT}"
  install -d -m 0750 -o borotalk -g borotalk "${DATA_ROOT}/uploads"
  install -d -m 0750 -o redis -g redis "${DATA_ROOT}/redis"
  install -d -m 0750 -o www-data -g adm /var/log/borotalk
}

ensure_database() {
  local db_password="$1"
  systemctl enable --now postgresql.service
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='borotalk'" | grep -q 1; then
    sudo -u postgres createuser --no-createdb --no-createrole --no-superuser borotalk
  fi
  sudo -u postgres psql -v ON_ERROR_STOP=1 \
    -c "ALTER ROLE borotalk WITH LOGIN PASSWORD '${db_password}' CONNECTION LIMIT 12;" >/dev/null
  if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='borotalk'" | grep -q 1; then
    sudo -u postgres createdb --owner=borotalk borotalk
  fi

  local pg_conf_dir
  pg_conf_dir="$(find /etc/postgresql -mindepth 3 -maxdepth 3 -type d -name conf.d | sort -V | tail -n 1)"
  if [ -n "${pg_conf_dir}" ]; then
    cat > "${pg_conf_dir}/99-borotalk-low-memory.conf" <<'EOF'
listen_addresses = '127.0.0.1'
max_connections = 30
shared_buffers = 64MB
work_mem = 2MB
maintenance_work_mem = 32MB
effective_cache_size = 256MB
EOF
    systemctl restart postgresql.service
  fi
}

write_env_file() {
  local public_host="$1" public_ip="$2" admin_email="$3" db_password="$4"
  local jwt_secret="$5" turn_secret="$6" webhook_secret="$7"
  local resend_key="$8" telegram_token="$9" telegram_username="${10}"
  local turn_host email_sender allow_test_sender

  if is_ipv4 "${public_host}"; then
    turn_host="${public_host}"
    email_sender="onboarding@resend.dev"
    allow_test_sender="true"
  else
    turn_host="turn.${public_host}"
    email_sender="${BOROTALK_EMAIL_FROM_EMAIL:-noreply@mail.${public_host#*.}}"
    allow_test_sender="false"
  fi

  umask 0027
  cat > "${ENV_FILE}" <<EOF
APP_ENV=production
APP_HOST=127.0.0.1
APP_PORT=8000
PUBLIC_BASE_URL=https://${public_host}
ALLOWED_ORIGINS=https://${public_host}
DATABASE_URL=postgresql+asyncpg://borotalk:${db_password}@127.0.0.1:5432/borotalk
DB_POOL_SIZE=4
DB_MAX_OVERFLOW=1
DB_POOL_TIMEOUT_SECONDS=10
REDIS_URL=redis://127.0.0.1:6380/0
JWT_SECRET_KEY=${jwt_secret}
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
UPLOADS_DIR=${DATA_ROOT}/uploads
PAGES_DIR=${INSTALL_DIR}/pages
FAVICON_PATH=${INSTALL_DIR}/favicon.ico
EMAIL_PROVIDER=resend
RESEND_API_KEY=${resend_key}
ALLOW_RESEND_TEST_SENDER=${allow_test_sender}
EMAIL_FROM_EMAIL=${email_sender}
EMAIL_FROM_NAME=Borotalk
TELEGRAM_BOT_TOKEN=${telegram_token}
TELEGRAM_BOT_USERNAME=${telegram_username}
TELEGRAM_WEBHOOK_SECRET=${webhook_secret}
TURN_HOST=${turn_host}
TURN_PORT=3478
TURN_ALT_UDP_PORT=443
TURN_TLS_PORT=5349
TURN_SHARED_SECRET=${turn_secret}
TURN_CREDENTIAL_TTL_SECONDS=3600
BOOTSTRAP_ADMIN_EMAIL=${admin_email}
OFFICIAL_DESKTOP_HOST=https://${public_host}
EOF
  chown root:borotalk "${ENV_FILE}"
  chmod 0640 "${ENV_FILE}"
}

set_env_value() {
  local key="$1" value="$2" temporary="${ENV_FILE}.tmp"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { found=0 }
    index($0, key "=") == 1 { print key "=" value; found=1; next }
    { print }
    END { if (!found) print key "=" value }
  ' "${ENV_FILE}" > "${temporary}"
  chown root:borotalk "${temporary}"
  chmod 0640 "${temporary}"
  mv "${temporary}" "${ENV_FILE}"
}

install_python() {
  python3 -m venv "${INSTALL_DIR}/.venv-native"
  "${INSTALL_DIR}/.venv-native/bin/pip" install --disable-pip-version-check --no-cache-dir -U pip wheel
  "${INSTALL_DIR}/.venv-native/bin/pip" install --disable-pip-version-check --no-cache-dir -r "${INSTALL_DIR}/requirements.txt"

  python3 -m venv "${CERTBOT_VENV}"
  "${CERTBOT_VENV}/bin/pip" install --disable-pip-version-check --no-cache-dir -U pip
  "${CERTBOT_VENV}/bin/pip" install --disable-pip-version-check --no-cache-dir 'certbot==5.7.0'
}

issue_certificate() {
  local public_host="$1" admin_email="$2" turn_host
  local certbot=("${CERTBOT_VENV}/bin/certbot" certonly --standalone --non-interactive --agree-tos --email "${admin_email}" --cert-name borotalk --force-renewal)
  if is_ipv4 "${public_host}"; then
    "${certbot[@]}" --preferred-profile shortlived --ip-address "${public_host}"
  else
    turn_host="turn.${public_host}"
    [ "$(getent ahostsv4 "${public_host}" | awk 'NR==1 {print $1}')" = "$(public_ipv4)" ] \
      || die "${public_host} does not resolve to this VPS."
    [ "$(getent ahostsv4 "${turn_host}" | awk 'NR==1 {print $1}')" = "$(public_ipv4)" ] \
      || die "${turn_host} does not resolve to this VPS."
    "${certbot[@]}" -d "${public_host}" -d "${turn_host}"
  fi
}

render_configs() {
  local public_host="$1" public_ip="$2" turn_host="$3" turn_secret="$4"
  sed "s/__PUBLIC_HOST__/${public_host}/g" \
    "${INSTALL_DIR}/deploy/native/nginx.conf.template" > "${ENV_DIR}/nginx.conf"
  install -m 0644 "${INSTALL_DIR}/deploy/native/proxy-headers.conf" "${ENV_DIR}/proxy-headers.conf"
  sed -e "s/__PUBLIC_IP__/${public_ip}/g" \
      -e "s/__TURN_HOST__/${turn_host}/g" \
      -e "s/__TURN_SECRET__/${turn_secret}/g" \
      "${INSTALL_DIR}/deploy/native/turnserver.conf.template" > "${ENV_DIR}/turnserver.conf"
  sed -e "s/__PUBLIC_IP__/${public_ip}/g" \
      -e "s/__TURN_HOST__/${turn_host}/g" \
      -e "s/__TURN_SECRET__/${turn_secret}/g" \
      "${INSTALL_DIR}/deploy/native/turnserver-udp443.conf.template" > "${ENV_DIR}/turnserver-udp443.conf"
  chmod 0640 "${ENV_DIR}/turnserver.conf" "${ENV_DIR}/turnserver-udp443.conf"
  chown root:turnserver "${ENV_DIR}/turnserver.conf" "${ENV_DIR}/turnserver-udp443.conf"
}

install_units() {
  local unit
  for unit in \
    borotalk-api.service borotalk-worker.service borotalk-redis.service \
    borotalk-nginx.service borotalk-turn.service borotalk-turn-udp443.service \
    borotalk-backup.service borotalk-backup.timer \
    borotalk-health.service borotalk-health.timer \
    borotalk-cert-renew.service borotalk-cert-renew.timer; do
    install -m 0644 "${INSTALL_DIR}/deploy/native/${unit}" "/etc/systemd/system/${unit}"
  done
  install -m 0644 "${INSTALL_DIR}/deploy/native/redis.conf" "${ENV_DIR}/redis.conf"
  systemctl daemon-reload
}

run_migrations() {
  sudo -u borotalk /bin/bash -c \
    'set -a; . "$1"; cd "$2"; exec .venv-native/bin/alembic -c alembic.ini upgrade head' \
    borotalk-migrate "${ENV_FILE}" "${INSTALL_DIR}"
}

set_telegram_webhook() {
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
  "${INSTALL_DIR}/.venv-native/bin/python" - <<'PY'
import json
import os
import urllib.parse
import urllib.request

token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
base_url = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
if not token:
    print("Telegram bot is not configured; web review queue remains available")
    raise SystemExit(0)
if not secret:
    raise SystemExit("Telegram webhook secret is missing")
payload = urllib.parse.urlencode({
    "url": f"{base_url}/api/integrations/telegram/webhook",
    "secret_token": secret,
    "allowed_updates": json.dumps(["message", "callback_query"]),
}).encode()
with urllib.request.urlopen(
    urllib.request.Request(f"https://api.telegram.org/bot{token}/setWebhook", data=payload),
    timeout=20,
) as response:
    result = json.load(response)
if not result.get("ok"):
    raise SystemExit(f"Telegram webhook failed: {result.get('description', 'unknown error')}")
print("Telegram webhook configured")
PY
}

start_services() {
  systemctl enable --now borotalk-redis.service
  systemctl enable --now borotalk-api.service borotalk-worker.service
  systemctl enable --now borotalk-turn.service borotalk-turn-udp443.service
  systemctl enable --now borotalk-nginx.service
  systemctl enable --now borotalk-backup.timer borotalk-health.timer borotalk-cert-renew.timer
}

run_check() {
  [ -r "${ENV_FILE}" ] || die "Borotalk is not installed."
  bash "${INSTALL_DIR}/deploy/scripts/check-native-vps-health.sh"
  ss -H -lntup | grep -E ':(80|443|3478|5349|610[0-9]{2}|61100)\b' || true
}

run_install() {
  require_snapshot
  require_disk 4194304
  check_required_ports
  record_baseline
  trap on_install_error ERR

  local public_ip public_host admin_email resend_key telegram_token telegram_username
  local db_password jwt_secret turn_secret webhook_secret
  public_ip="$(public_ipv4)"
  public_host="${BOROTALK_PUBLIC_HOST:-${public_ip}}"
  admin_email="${BOROTALK_ADMIN_EMAIL:-}"
  resend_key="${BOROTALK_RESEND_API_KEY:-}"
  telegram_token="${BOROTALK_TELEGRAM_BOT_TOKEN:-}"
  telegram_username="${BOROTALK_TELEGRAM_BOT_USERNAME:-}"

  is_ipv4 "${public_host}" || is_domain "${public_host}" \
    || die "BOROTALK_PUBLIC_HOST must be a public IPv4 address or domain."
  if is_ipv4 "${public_host}" && [ "${public_host}" != "${public_ip}" ]; then
    die "BOROTALK_PUBLIC_HOST must match this VPS public IPv4 (${public_ip})."
  fi
  prompt_value admin_email "Owner email"
  [[ "${admin_email}" == *@*.* ]] || die "Invalid owner email."
  prompt_value resend_key "Resend API key" "" 1
  [[ "${resend_key}" == re_* ]] || die "Invalid Resend API key format."
  if [ -z "${telegram_token}" ] && [ -t 0 ]; then
    read -r -s -p "Telegram bot token (optional, Enter to configure later): " telegram_token
    printf '\n'
  fi
  if [ -n "${telegram_token}" ]; then
    [[ "${telegram_token}" == *:* ]] || die "Invalid Telegram bot token format."
    prompt_value telegram_username "Telegram bot username without @" "borotalkbot"
    telegram_username="${telegram_username#@}"
  else
    telegram_username=""
  fi

  log "Installing isolated system packages"
  install_packages
  ensure_users_and_directories
  install_source

  db_password="$(openssl rand -hex 24)"
  jwt_secret="$(openssl rand -hex 48)"
  turn_secret="$(openssl rand -hex 48)"
  webhook_secret="$(openssl rand -hex 32)"

  log "Configuring PostgreSQL and Python"
  ensure_database "${db_password}"
  install_python
  write_env_file \
    "${public_host}" "${public_ip}" "${admin_email}" "${db_password}" \
    "${jwt_secret}" "${turn_secret}" "${webhook_secret}" \
    "${resend_key}" "${telegram_token}" "${telegram_username}"

  log "Issuing the HTTPS certificate"
  issue_certificate "${public_host}" "${admin_email}"
  local turn_host
  turn_host="${public_host}"
  is_ipv4 "${public_host}" || turn_host="turn.${public_host}"
  render_configs "${public_host}" "${public_ip}" "${turn_host}" "${turn_secret}"
  install_units
  run_migrations

  log "Starting Borotalk"
  start_services
  set_telegram_webhook
  assert_protected_services
  run_check
  trap - ERR

  printf '\nBorotalk is ready at https://%s\n' "${public_host}"
  if is_ipv4 "${public_host}"; then
    printf 'IP mode is active. Resend test mail is limited to the account owner.\n'
    printf 'Later switch to a domain with: sudo bash %s/INSTALL_VPS_NATIVE.sh --switch-host borotalk.example.com\n' "${INSTALL_DIR}"
  fi
}

run_update() {
  require_disk 2097152
  if [ ! -d "${INSTALL_DIR}/.git" ] && [ ! -f "${INSTALL_DIR}/.borotalk-native-bundled-source" ]; then
    die "A Git checkout or native bundle installation is required."
  fi
  bash "${INSTALL_DIR}/deploy/scripts/backup-native-data.sh"
  if [ -d "${INSTALL_DIR}/.git" ]; then
    install_source
  fi
  install_python
  install_units
  run_migrations
  systemctl restart borotalk-api.service borotalk-worker.service
  run_check
}

run_switch_host() {
  local new_host="${2:-}" public_ip admin_email turn_host turn_secret
  [ -n "${new_host}" ] || die "Usage: $0 --switch-host borotalk.example.com"
  is_domain "${new_host}" || die "A valid domain is required."
  [ -r "${ENV_FILE}" ] || die "Borotalk is not installed."
  require_disk 2097152

  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
  admin_email="${BOOTSTRAP_ADMIN_EMAIL}"
  turn_secret="${TURN_SHARED_SECRET}"
  public_ip="$(public_ipv4)"
  turn_host="turn.${new_host}"

  [ "$(getent ahostsv4 "${new_host}" | awk 'NR==1 {print $1}')" = "${public_ip}" ] \
    || die "${new_host} does not resolve to ${public_ip}."
  [ "$(getent ahostsv4 "${turn_host}" | awk 'NR==1 {print $1}')" = "${public_ip}" ] \
    || die "${turn_host} does not resolve to ${public_ip}."

  cp -a "${ENV_FILE}" "${ENV_FILE}.before-domain-switch"
  cp -a "${ENV_DIR}/nginx.conf" "${ENV_DIR}/nginx.conf.before-domain-switch"
  systemctl stop borotalk-nginx.service
  if ! issue_certificate "${new_host}" "${admin_email}"; then
    systemctl start borotalk-nginx.service
    die "Certificate issuance failed; the IP configuration is still active."
  fi

  set_env_value PUBLIC_BASE_URL "https://${new_host}"
  set_env_value ALLOWED_ORIGINS "https://${new_host}"
  set_env_value TURN_HOST "${turn_host}"
  set_env_value OFFICIAL_DESKTOP_HOST "https://${new_host}"
  if [ -n "${BOROTALK_EMAIL_FROM_EMAIL:-}" ]; then
    set_env_value EMAIL_FROM_EMAIL "${BOROTALK_EMAIL_FROM_EMAIL}"
    set_env_value ALLOW_RESEND_TEST_SENDER false
  fi
  render_configs "${new_host}" "${public_ip}" "${turn_host}" "${turn_secret}"
  systemctl restart borotalk-api.service borotalk-worker.service \
    borotalk-turn.service borotalk-turn-udp443.service borotalk-nginx.service
  set_telegram_webhook
  run_check
  printf '\nDomain switch complete: https://%s\nExisting users must sign in again once.\n' "${new_host}"
}

require_root
case "${mode}" in
  install|"") run_install ;;
  --check) run_check ;;
  --update) run_update ;;
  --switch-host) run_switch_host "$@" ;;
  *) die "Usage: $0 [--check|--update|--switch-host DOMAIN]" ;;
esac
