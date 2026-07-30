#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <staging|production>" >&2
  exit 1
fi

env_name="$1"

case "${env_name}" in
  production)
    branch="main"
    compose_project="borofone-prod"
    compose_file="deploy/docker/docker-compose.prod.yml"
    db_name="borofone_prod"
    uploads_volume="borofone-prod_uploads_data"
    ;;
  staging)
    branch="dev"
    compose_project="borofone-staging"
    compose_file="deploy/docker/docker-compose.staging.yml"
    db_name="borofone_staging"
    uploads_volume="borofone-staging_uploads_data"
    ;;
  *)
    echo "unsupported environment: ${env_name}" >&2
    exit 1
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
    COMPOSE_FLAVOR="plugin"
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN=(docker-compose)
    COMPOSE_FLAVOR="legacy"
    return 0
  fi

  echo "docker compose or docker-compose is required" >&2
  exit 1
}

wait_for_service() {
  local service_name="$1"
  local timeout_seconds="$2"
  local start_time
  local container_id=""
  local status

  start_time="$(date +%s)"

  while true; do
    container_id="$("${compose_cmd[@]}" ps -q "${service_name}" | head -n 1)"
    if [ -n "${container_id}" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      case "${status}" in
        healthy|running)
          echo "[deploy] ${service_name} is ${status}"
          return 0
          ;;
        unhealthy|exited|dead)
          echo "[deploy] ${service_name} became ${status}" >&2
          docker logs "${container_id}" --tail 50 || true
          return 1
          ;;
      esac
    fi

    if [ "$(date +%s)" -ge "$((start_time + timeout_seconds))" ]; then
      echo "[deploy] timed out waiting for ${service_name}" >&2
      if [ -n "${container_id}" ]; then
        docker logs "${container_id}" --tail 50 || true
      fi
      return 1
    fi

    sleep 2
  done
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

resolve_compose_cmd
compose_cmd=("${COMPOSE_BIN[@]}" -p "${compose_project}" -f "${compose_file}")

cd "${repo_root}"

if [ "${SKIP_GIT_SYNC:-0}" != "1" ]; then
  if [ -n "$(git status --porcelain)" ]; then
    echo "refusing to deploy over local repository changes" >&2
    exit 1
  fi
  git fetch --prune origin
  git checkout "${branch}" || git checkout -b "${branch}" --track "origin/${branch}"
  git merge --ff-only "origin/${branch}"
fi

if [ ! -f .env ]; then
  echo "missing ${repo_root}/.env" >&2
  exit 1
fi

set -a
. "${repo_root}/.env"
set +a

: "${HOST_DATA_ROOT:?HOST_DATA_ROOT must be set in .env}"
: "${BACKUP_ROOT:?BACKUP_ROOT must be set in .env}"
if [ "${env_name}" = "production" ]; then
  : "${PUBLIC_BASE_URL:?PUBLIC_BASE_URL must be set in .env}"
  : "${TURN_HOST:?TURN_HOST must be set in .env}"
  : "${TURN_EXTERNAL_IP:?TURN_EXTERNAL_IP must be set in .env}"
  : "${TURN_SHARED_SECRET:?TURN_SHARED_SECRET must be set in .env}"
  if [[ "${PUBLIC_BASE_URL}" != https://* ]]; then
    echo "PUBLIC_BASE_URL must use HTTPS" >&2
    exit 1
  fi
  for required_name in POSTGRES_PASSWORD JWT_SECRET_KEY TURN_SHARED_SECRET SMTP_HOST SMTP_USERNAME SMTP_PASSWORD SMTP_FROM_EMAIL TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME TELEGRAM_WEBHOOK_SECRET BOOTSTRAP_ADMIN_EMAIL; do
    required_value="${!required_name:-}"
    if [ -z "${required_value}" ] || [[ "${required_value}" == change-me* ]]; then
      echo "${required_name} must be configured in .env" >&2
      exit 1
    fi
  done
fi

case "${HOST_DATA_ROOT}" in
  /*) ;;
  *)
    echo "HOST_DATA_ROOT must be an absolute path: ${HOST_DATA_ROOT}" >&2
    exit 1
    ;;
esac

case "${BACKUP_ROOT}" in
  /*) ;;
  *)
    echo "BACKUP_ROOT must be an absolute path: ${BACKUP_ROOT}" >&2
    exit 1
    ;;
esac

mkdir -p "${HOST_DATA_ROOT}" "${BACKUP_ROOT}"

echo "[deploy] $(date -Is) start ${env_name}"
bash deploy/scripts/backup-compose-data.sh "${env_name}" "${compose_project}" "${compose_file}" "${db_name}" "${uploads_volume}"
bash deploy/scripts/prepare-persistent-data.sh "${env_name}"
"${compose_cmd[@]}" config >/dev/null
"${compose_cmd[@]}" up -d --no-recreate postgres redis
wait_for_service postgres 120
wait_for_service redis 60
"${compose_cmd[@]}" build api worker
"${compose_cmd[@]}" run --rm api alembic upgrade head
if [ "${COMPOSE_FLAVOR}" = "legacy" ]; then
  echo "[deploy] using legacy docker-compose workaround for service recreation"
  "${compose_cmd[@]}" stop api worker || true
  "${compose_cmd[@]}" rm -f api worker || true
  "${compose_cmd[@]}" up -d --no-deps api worker
else
  "${compose_cmd[@]}" up -d --no-deps --force-recreate api worker
fi
if [ "${env_name}" = "production" ]; then
  "${compose_cmd[@]}" up -d --force-recreate coturn
fi
wait_for_service api 120
wait_for_service worker 60

if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_WEBHOOK_SECRET:-}" ]; then
  webhook_response="$(
    curl -fsS \
      --data-urlencode "url=${PUBLIC_BASE_URL%/}/api/integrations/telegram/webhook" \
      --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
      --data-urlencode 'allowed_updates=["message","callback_query"]' \
      "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook"
  )"
  if ! printf '%s' "${webhook_response}" | grep -q '"ok":true'; then
    echo "[deploy] Telegram webhook setup failed" >&2
    exit 1
  fi
fi
"${compose_cmd[@]}" ps
echo "[deploy] $(date -Is) done ${env_name}"
