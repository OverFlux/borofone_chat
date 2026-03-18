#!/usr/bin/env bash
set -euxo pipefail

REPO_URL="${REPO_URL:-git@github.com:your-org/borofone_chat.git}"
PROD_PATH="/opt/borofone-chat-prod"
STAGING_PATH="/opt/borofone-chat-staging"
PROD_DATA_ROOT="/var/lib/borofone/production"
STAGING_DATA_ROOT="/var/lib/borofone/staging"
BACKUP_ROOT="/var/backups/borofone"
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP_PENDING=0

mkdir -p "${PROD_PATH}" "${STAGING_PATH}" "${PROD_DATA_ROOT}" "${STAGING_DATA_ROOT}" "${BACKUP_ROOT}"

if [ ! -d "${PROD_PATH}/.git" ]; then
  git clone "${REPO_URL}" "${PROD_PATH}"
fi

if [ ! -d "${STAGING_PATH}/.git" ]; then
  git clone "${REPO_URL}" "${STAGING_PATH}"
fi

cd "${PROD_PATH}"
git fetch --prune origin
git checkout main || git checkout -b main --track origin/main
if [ ! -f .env ]; then
  cp deploy/env/.env.production.example .env
  BOOTSTRAP_PENDING=1
fi
mkdir -p "${PROD_DATA_ROOT}/uploads/avatars" "${PROD_DATA_ROOT}/uploads/attachments" "${PROD_DATA_ROOT}/leaderboard"

cd "${STAGING_PATH}"
git fetch --prune origin
git checkout dev || git checkout -b dev --track origin/dev
if [ ! -f .env ]; then
  cp deploy/env/.env.staging.example .env
  BOOTSTRAP_PENDING=1
fi
mkdir -p "${STAGING_DATA_ROOT}/uploads/avatars" "${STAGING_DATA_ROOT}/uploads/attachments" "${STAGING_DATA_ROOT}/leaderboard"

install -m 644 "${SCRIPT_ROOT}/deploy/nginx/borofone.conf" /etc/nginx/sites-available/borofone.conf
ln -sfn /etc/nginx/sites-available/borofone.conf /etc/nginx/sites-enabled/borofone.conf

nginx -t
systemctl reload nginx

if [ "${BOOTSTRAP_PENDING}" -eq 1 ]; then
  echo "Edit ${PROD_PATH}/.env and ${STAGING_PATH}/.env, then rerun this script to perform the first Docker-based deploy."
  exit 0
fi

bash "${PROD_PATH}/deploy/scripts/deploy-stack.sh" production
bash "${STAGING_PATH}/deploy/scripts/deploy-stack.sh" staging
