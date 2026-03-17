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

backup_root="backups/${env_name}"
timestamp="$(date +%Y%m%d-%H%M%S)"
target_dir="${backup_root}/${timestamp}"
mkdir -p "${target_dir}"

compose_cmd=(docker-compose -p "${compose_project}" -f "${compose_file}")

"${compose_cmd[@]}" up -d --no-recreate postgres redis
"${compose_cmd[@]}" exec -T postgres sh -lc 'until pg_isready -U "${POSTGRES_USER:-app}" -d postgres -h 127.0.0.1; do sleep 1; done'

if "${compose_cmd[@]}" exec -T postgres sh -lc "psql -U \"\${POSTGRES_USER:-app}\" -d postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='${db_name}'\" | grep -q 1"; then
  "${compose_cmd[@]}" exec -T postgres sh -lc "pg_dump -U \"\${POSTGRES_USER:-app}\" -d \"${db_name}\" --clean --if-exists --no-owner --no-privileges" | gzip -9 > "${target_dir}/${db_name}.sql.gz"
fi

if docker volume inspect "${uploads_volume}" >/dev/null 2>&1; then
  docker run --rm \
    -v "${uploads_volume}:/source:ro" \
    -v "${PWD}/${target_dir}:/backup" \
    alpine:3.20 \
    sh -lc 'cd /source && tar -czf /backup/uploads.tar.gz .'
fi

find "${backup_root}" -mindepth 1 -maxdepth 1 -type d | sort | head -n -10 | xargs -r rm -rf
echo "[backup] ${env_name} saved to ${target_dir}"
