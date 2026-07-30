#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <environment>" >&2
  exit 1
fi

env_name="$1"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
cd "${repo_root}"

if [ ! -f .env ]; then
  echo "missing ${repo_root}/.env" >&2
  exit 1
fi
set -a
. ./.env
set +a

backup_root="${BACKUP_ROOT:?BACKUP_ROOT is required}/${env_name}"
latest_dump="$(find "${backup_root}" -mindepth 2 -maxdepth 2 -type f -name '*.sql.gz' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)"
if [ -z "${latest_dump}" ] || [ ! -f "${latest_dump}" ]; then
  echo "[restore-check] no PostgreSQL backup found in ${backup_root}" >&2
  exit 1
fi

container_name="borotalk-restore-check-$$"
restore_password="$(openssl rand -hex 18)"
cleanup() {
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --rm \
  --name "${container_name}" \
  -e POSTGRES_PASSWORD="${restore_password}" \
  -e POSTGRES_DB=restore_check \
  postgres:16 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "${container_name}" pg_isready -U postgres -d restore_check >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "${container_name}" pg_isready -U postgres -d restore_check >/dev/null
gzip -dc "${latest_dump}" | docker exec -i "${container_name}" psql -v ON_ERROR_STOP=1 -U postgres -d restore_check >/dev/null
docker exec "${container_name}" psql -U postgres -d restore_check -tAc \
  "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users'" \
  | grep -q 1
echo "[restore-check] ${latest_dump} restored successfully"
