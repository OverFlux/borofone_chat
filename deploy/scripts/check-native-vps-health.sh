#!/usr/bin/env bash
set -euo pipefail

env_file="${BOROTALK_ENV_FILE:-/etc/borotalk/borotalk.env}"
[ -r "${env_file}" ] || { echo "missing ${env_file}" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "${env_file}"
set +a

failed=0
check_service() {
  if systemctl is-active --quiet "$1"; then
    printf 'OK   %s\n' "$1"
  else
    printf 'FAIL %s\n' "$1" >&2
    failed=1
  fi
}

for service in \
  postgresql.service \
  borotalk-redis.service \
  borotalk-api.service \
  borotalk-worker.service \
  borotalk-nginx.service \
  borotalk-turn.service \
  borotalk-turn-udp443.service; do
  check_service "${service}"
done

for protected_service in x-ui.service callsnif.service vpn-misa-bot.service; do
  if systemctl cat "${protected_service}" >/dev/null 2>&1; then
    check_service "${protected_service}"
  fi
done

health_ready=0
for _attempt in {1..10}; do
  if curl --fail --silent --max-time 15 "${PUBLIC_BASE_URL%/}/healthz" >/dev/null; then
    health_ready=1
    break
  fi
  sleep 2
done
if [ "${health_ready}" -eq 1 ]; then
  printf 'OK   %s/healthz\n' "${PUBLIC_BASE_URL%/}"
else
  printf 'FAIL %s/healthz\n' "${PUBLIC_BASE_URL%/}" >&2
  failed=1
fi

available_kb="$(df -Pk / | awk 'NR==2 {print $4}')"
available_mem_kb="$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)"
if [ "${available_kb:-0}" -lt 2097152 ]; then
  printf 'FAIL disk: less than 2 GiB available\n' >&2
  failed=1
else
  printf 'OK   disk: %s MiB available\n' "$((available_kb / 1024))"
fi
if [ "${available_mem_kb:-0}" -lt 153600 ]; then
  printf 'WARN memory: less than 150 MiB available (%s MiB)\n' "$((available_mem_kb / 1024))" >&2
else
  printf 'OK   memory: %s MiB available\n' "$((available_mem_kb / 1024))"
fi

exit "${failed}"
