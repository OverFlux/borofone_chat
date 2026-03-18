#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 5 ]; then
  echo "usage: $0 <env-name> <compose-project> <compose-file> <db-name> <uploads-volume>" >&2
  exit 1
fi

env_name="$1"
compose_project="$2"
compose_file="$3"
db_name="$4"
uploads_volume="$5"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"

resolve_compose_cmd() {
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_BIN=(docker compose)
    return 0
  fi

  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_BIN=(docker-compose)
    return 0
  fi

  echo "docker compose or docker-compose is required" >&2
  exit 1
}

if [ ! -f "${repo_root}/.env" ]; then
  echo "missing ${repo_root}/.env" >&2
  exit 1
fi

set -a
. "${repo_root}/.env"
set +a

: "${BACKUP_ROOT:?BACKUP_ROOT must be set in .env}"
: "${HOST_DATA_ROOT:?HOST_DATA_ROOT must be set in .env}"

backup_root="${BACKUP_ROOT%/}/${env_name}"
timestamp="$(date +%Y%m%d-%H%M%S)"
target_dir="${backup_root}/${timestamp}"
mkdir -p "${target_dir}"

resolve_compose_cmd
compose_cmd=("${COMPOSE_BIN[@]}" -p "${compose_project}" -f "${compose_file}")
host_uploads_dir="${HOST_DATA_ROOT%/}/uploads"
host_leaderboard_dir="${HOST_DATA_ROOT%/}/leaderboard"
legacy_leaderboard_dir="${repo_root}/data/leaderboard"

tar_directory() {
  local source_dir="$1"
  local target_archive="$2"

  if [ ! -d "${source_dir}" ]; then
    return 1
  fi

  if [ -z "$(find "${source_dir}" -mindepth 1 -print -quit 2>/dev/null)" ]; then
    return 1
  fi

  tar -C "${source_dir}" -czf "${target_archive}" .
}

"${compose_cmd[@]}" up -d --no-recreate postgres redis
"${compose_cmd[@]}" exec -T postgres sh -lc 'until pg_isready -U "${POSTGRES_USER:-app}" -d postgres -h 127.0.0.1; do sleep 1; done'

if "${compose_cmd[@]}" exec -T postgres sh -lc "psql -U \"\${POSTGRES_USER:-app}\" -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='${db_name}'\" | grep -q 1"; then
  "${compose_cmd[@]}" exec -T postgres sh -lc "pg_dump -U \"\${POSTGRES_USER:-app}\" -d \"${db_name}\" --clean --if-exists --no-owner --no-privileges" | gzip -9 > "${target_dir}/${db_name}.sql.gz"
fi

if tar_directory "${host_uploads_dir}" "${target_dir}/uploads.tar.gz"; then
  :
elif docker volume inspect "${uploads_volume}" >/dev/null 2>&1; then
  docker run --rm \
    -v "${uploads_volume}:/source:ro" \
    -v "${target_dir}:/backup" \
    alpine:3.20 \
    sh -lc 'cd /source && tar -czf /backup/uploads.tar.gz .'
fi

if ! tar_directory "${host_leaderboard_dir}" "${target_dir}/leaderboard.tar.gz"; then
  tar_directory "${legacy_leaderboard_dir}" "${target_dir}/leaderboard.tar.gz" || true
fi

cp "${repo_root}/.env" "${target_dir}/.env"

find "${backup_root}" -mindepth 1 -maxdepth 1 -type d | sort | head -n -10 | xargs -r rm -rf
echo "[backup] ${env_name} saved to ${target_dir}"
