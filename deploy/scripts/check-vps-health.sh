#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <public-domain>" >&2
  exit 1
fi

domain="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

if [ ! -f .env ]; then
  echo "[health] missing ${repo_root}/.env" >&2
  exit 1
fi
set -a
. ./.env
set +a

failures=0
check() {
  local label="$1"
  shift
  if "$@"; then
    echo "[health] ok: ${label}"
  else
    echo "[health] failed: ${label}" >&2
    failures=$((failures + 1))
  fi
}

check "API, PostgreSQL and Redis" curl -fsS --max-time 10 -o /dev/null "https://${domain}/healthz"
if openssl s_client -connect "${domain}:443" -servername "${domain}" </dev/null 2>/dev/null \
  | openssl x509 -checkend 604800 -noout; then
  echo "[health] ok: TLS certificate valid for at least seven days"
else
  echo "[health] failed: TLS certificate expires in less than seven days" >&2
  failures=$((failures + 1))
fi

disk_percent="$(df -P "${HOST_DATA_ROOT:?HOST_DATA_ROOT is required}" | awk 'NR==2 {gsub("%", "", $5); print $5}')"
if [ -z "${disk_percent}" ] || [ "${disk_percent}" -ge 85 ]; then
  echo "[health] failed: disk usage is ${disk_percent:-unknown}%" >&2
  failures=$((failures + 1))
else
  echo "[health] ok: disk usage is ${disk_percent}%"
fi

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose -p borofone-prod -f deploy/docker/docker-compose.prod.yml)
else
  compose=(docker-compose -p borofone-prod -f deploy/docker/docker-compose.prod.yml)
fi
coturn_id="$("${compose[@]}" ps -q coturn 2>/dev/null || true)"
check "coturn container" test -n "${coturn_id}"
if [ -n "${coturn_id}" ]; then
  check "coturn process" test "$(docker inspect -f '{{.State.Running}}' "${coturn_id}")" = "true"
fi

failed_outbox="$(
  "${compose[@]}" exec -T postgres sh -lc \
    'psql -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-borofone_prod}" -tAc "SELECT count(*) FROM notification_outbox WHERE sent_at IS NULL AND attempts >= 5"' \
    2>/dev/null | tr -d '[:space:]' || true
)"
if [ -z "${failed_outbox}" ] || [ "${failed_outbox}" -gt 0 ]; then
  echo "[health] failed: stuck outbox deliveries ${failed_outbox:-unknown}" >&2
  failures=$((failures + 1))
else
  echo "[health] ok: outbox has no stuck deliveries"
fi

exit "${failures}"
