#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <staging|production>" >&2
  exit 1
fi

env_name="$1"

case "${env_name}" in
  production)
    uploads_volume="borofone-prod_uploads_data"
    legacy_unit="borofone-prod"
    ;;
  staging)
    uploads_volume="borofone-staging_uploads_data"
    legacy_unit="borofone-staging"
    ;;
  *)
    echo "unsupported environment: ${env_name}" >&2
    exit 1
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"

if [ ! -f "${repo_root}/.env" ]; then
  echo "missing ${repo_root}/.env" >&2
  exit 1
fi

set -a
. "${repo_root}/.env"
set +a

: "${HOST_DATA_ROOT:?HOST_DATA_ROOT must be set in .env}"

case "${HOST_DATA_ROOT}" in
  /*) ;;
  *)
    echo "HOST_DATA_ROOT must be an absolute path: ${HOST_DATA_ROOT}" >&2
    exit 1
    ;;
esac

host_root="${HOST_DATA_ROOT%/}"
uploads_dir="${host_root}/uploads"
leaderboard_dir="${host_root}/leaderboard"
marker_file="${host_root}/.persistent-data-migrated"
legacy_leaderboard_dir="${repo_root}/data/leaderboard"

is_dir_empty() {
  local dir_path="$1"
  [ ! -d "${dir_path}" ] || [ -z "$(find "${dir_path}" -mindepth 1 -print -quit 2>/dev/null)" ]
}

copy_volume_to_dir() {
  local volume_name="$1"
  local target_dir="$2"

  docker run --rm \
    -v "${volume_name}:/source:ro" \
    -v "${target_dir}:/target" \
    alpine:3.20 \
    sh -lc 'cd /source && tar -cf - . | tar -xf - -C /target'
}

mkdir -p \
  "${uploads_dir}" \
  "${leaderboard_dir}"

if [ ! -f "${marker_file}" ]; then
  if is_dir_empty "${uploads_dir}" && docker volume inspect "${uploads_volume}" >/dev/null 2>&1; then
    echo "[storage] migrating uploads from ${uploads_volume} to ${uploads_dir}"
    copy_volume_to_dir "${uploads_volume}" "${uploads_dir}"
  else
    echo "[storage] uploads migration skipped"
  fi

  if is_dir_empty "${leaderboard_dir}" && [ -d "${legacy_leaderboard_dir}" ]; then
    echo "[storage] migrating leaderboard files from ${legacy_leaderboard_dir} to ${leaderboard_dir}"
    cp -a "${legacy_leaderboard_dir}/." "${leaderboard_dir}/"
  else
    echo "[storage] leaderboard migration skipped"
  fi

  cat > "${marker_file}" <<EOF
completed_at=$(date -Is)
environment=${env_name}
uploads_volume=${uploads_volume}
legacy_leaderboard_dir=${legacy_leaderboard_dir}
EOF
else
  echo "[storage] marker already present at ${marker_file}"
fi

mkdir -p "${uploads_dir}/avatars" "${uploads_dir}/attachments"

if command -v systemctl >/dev/null 2>&1 && systemctl cat "${legacy_unit}" >/dev/null 2>&1; then
  echo "[storage] disabling legacy unit ${legacy_unit}"
  systemctl stop "${legacy_unit}" || true
  systemctl disable "${legacy_unit}" || true
  systemctl mask "${legacy_unit}" || true
fi
