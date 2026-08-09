#!/usr/bin/env bash
set -euo pipefail

backup_root="${BOROTALK_BACKUP_ROOT:-/var/backups/borotalk}"
data_root="${BOROTALK_DATA_ROOT:-/var/lib/borotalk}"
database_name="${BOROTALK_DATABASE_NAME:-borotalk}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="${backup_root}/${timestamp}"

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root" >&2
  exit 1
fi

case "${backup_root}" in
  /var/backups/borotalk|/var/backups/borotalk/*) ;;
  *) echo "unsafe backup root: ${backup_root}" >&2; exit 1 ;;
esac

available_kb="$(df -Pk "${backup_root%/*}" | awk 'NR==2 {print $4}')"
if [ "${available_kb:-0}" -lt 1048576 ]; then
  echo "less than 1 GiB is available; backup aborted" >&2
  exit 1
fi

install -d -m 0750 "${target}"
# Root opens the destination before pg_dump drops to the postgres account. This
# keeps each timestamped directory private without preventing PostgreSQL from
# writing the dump.
sudo -u postgres pg_dump --format=custom "${database_name}" > "${target}/postgres.dump"
if [ -d "${data_root}/uploads" ]; then
  tar -C "${data_root}" -czf "${target}/uploads.tar.gz" uploads
fi
sha256sum "${target}"/* > "${target}/SHA256SUMS"

mapfile -t old_backups < <(find "${backup_root}" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -r | tail -n +4)
for old_backup in "${old_backups[@]}"; do
  rm -rf -- "${backup_root:?}/${old_backup}"
done

echo "backup created: ${target}"
