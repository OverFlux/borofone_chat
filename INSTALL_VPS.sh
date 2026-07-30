#!/usr/bin/env bash
set -euo pipefail

readonly DEFAULT_REPOSITORY="https://github.com/OverFlux/borofone_chat.git"
readonly DEFAULT_INSTALL_DIR="/opt/borotalk"

mode="${1:-install}"
repo_url="${BOROTALK_REPO_URL:-${DEFAULT_REPOSITORY}}"
install_dir="${BOROTALK_INSTALL_DIR:-${DEFAULT_INSTALL_DIR}}"
if [[ "${install_dir}" == *[[:space:]]* ]]; then
  printf 'BOROTALK_INSTALL_DIR не должен содержать пробелы\n' >&2
  exit 1
fi

log() {
  printf '\n\033[1;36m[Borotalk]\033[0m %s\n' "$*"
}

die() {
  printf '\n\033[1;31m[Ошибка]\033[0m %s\n' "$*" >&2
  exit 1
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "Запустите файл через sudo: sudo bash INSTALL_VPS.sh"
  fi
}

prompt_value() {
  local variable_name="$1"
  local label="$2"
  local default_value="${3:-}"
  local secret="${4:-0}"
  local answer=""

  while [ -z "${answer}" ]; do
    if [ "${secret}" = "1" ]; then
      read -r -s -p "${label}: " answer
      printf '\n'
    elif [ -n "${default_value}" ]; then
      read -r -p "${label} [${default_value}]: " answer
      answer="${answer:-${default_value}}"
    else
      read -r -p "${label}: " answer
    fi
  done
  if [[ "${answer}" == *$'\n'* || "${answer}" == *$'\r'* ]]; then
    die "${label}: переносы строк запрещены"
  fi
  if [[ "${answer}" == *"'"* ]]; then
    die "${label}: одинарная кавычка не поддерживается в автоматической конфигурации"
  fi
  printf -v "${variable_name}" '%s' "${answer}"
}

quote_env_value() {
  local escaped
  escaped="$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
  printf "'%s'" "${escaped}"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local env_file="${install_dir}/.env"
  local temporary_file="${env_file}.tmp"
  local quoted
  quoted="$(quote_env_value "${value}")"

  : > "${temporary_file}"
  local replaced=0
  while IFS= read -r line || [ -n "${line}" ]; do
    if [[ "${line}" == "${key}="* ]]; then
      printf '%s=%s\n' "${key}" "${quoted}" >> "${temporary_file}"
      replaced=1
    else
      printf '%s\n' "${line}" >> "${temporary_file}"
    fi
  done < "${env_file}"
  if [ "${replaced}" -eq 0 ]; then
    printf '%s=%s\n' "${key}" "${quoted}" >> "${temporary_file}"
  fi
  chmod 600 "${temporary_file}"
  mv "${temporary_file}" "${env_file}"
}

resolve_ipv4() {
  getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | sort -u
}

require_clean_repository() {
  if [ ! -d "${install_dir}/.git" ]; then
    die "${install_dir} существует, но не является репозиторием Borotalk"
  fi
  if [ -n "$(git -C "${install_dir}" status --porcelain)" ]; then
    die "В ${install_dir} есть локальные изменения. Сохраните их перед обновлением."
  fi
}

update_repository() {
  require_clean_repository
  git -C "${install_dir}" fetch --prune origin
  git -C "${install_dir}" checkout main
  git -C "${install_dir}" merge --ff-only origin/main
}

run_check() {
  [ -f "${install_dir}/.env" ] || die "Borotalk ещё не установлен в ${install_dir}"
  cd "${install_dir}"
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  local public_domain="${PUBLIC_BASE_URL#https://}"
  public_domain="${public_domain%%/*}"
  bash deploy/scripts/check-vps-health.sh "${public_domain}"
  if docker compose version >/dev/null 2>&1; then
    docker compose -p borofone-prod -f deploy/docker/docker-compose.prod.yml ps
  else
    docker-compose -p borofone-prod -f deploy/docker/docker-compose.prod.yml ps
  fi
  printf '\nBorotalk доступен: %s\n' "${PUBLIC_BASE_URL}"
}

run_update() {
  update_repository
  cd "${install_dir}"
  SKIP_GIT_SYNC=1 bash deploy/scripts/deploy-stack.sh production
  run_check
}

install_borotalk() {
  command -v apt-get >/dev/null 2>&1 || die "Поддерживаются Ubuntu и Debian с apt"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git

  if [ "${BOROTALK_USE_EXISTING_SOURCE:-0}" = "1" ] \
    || [ -f "${install_dir}/.borotalk-bundled-source" ]; then
    [ -f "${install_dir}/deploy/scripts/prepare-vps.sh" ] \
      || die "Встроенная копия Borotalk повреждена"
    log "Использую встроенную версию Borotalk"
  elif [ -e "${install_dir}" ]; then
    require_clean_repository
    log "Обновляю существующий репозиторий"
    update_repository
  else
    log "Скачиваю Borotalk в ${install_dir}"
    git clone --branch main --single-branch "${repo_url}" "${install_dir}"
  fi

  local domain admin_email smtp_host smtp_port smtp_username smtp_password
  local smtp_from_email smtp_from_name telegram_bot_token telegram_bot_username
  local public_ip ssh_port ssh_connection

  log "Введите параметры. Секреты не показываются и сохраняются только в ${install_dir}/.env"
  prompt_value domain "Основной домен без https://, например talk.example.com"
  domain="${domain#https://}"
  domain="${domain%%/*}"
  domain="${domain,,}"
  [[ "${domain}" =~ ^[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "Некорректный домен: ${domain}"

  prompt_value admin_email "Email владельца и первого администратора"
  [[ "${admin_email}" == *@*.* ]] || die "Некорректный email"

  prompt_value smtp_host "SMTP host"
  prompt_value smtp_port "SMTP port" "587"
  [[ "${smtp_port}" =~ ^[0-9]+$ ]] || die "SMTP port должен быть числом"
  prompt_value smtp_username "SMTP username"
  prompt_value smtp_password "SMTP password" "" "1"
  prompt_value smtp_from_email "Адрес отправителя" "hello@${domain}"
  prompt_value smtp_from_name "Имя отправителя" "Borotalk"

  prompt_value telegram_bot_token "Telegram bot token от @BotFather" "" "1"
  [[ "${telegram_bot_token}" == *:* ]] || die "Telegram bot token выглядит некорректно"
  prompt_value telegram_bot_username "Username Telegram-бота без @"
  telegram_bot_username="${telegram_bot_username#@}"

  public_ip="$(curl -fsS --ipv4 https://api.ipify.org)"
  ssh_connection="${SSH_CONNECTION:-}"
  ssh_port="${BOROTALK_SSH_PORT:-}"
  if [ -z "${ssh_port}" ] && [ -n "${ssh_connection}" ]; then
    ssh_port="${ssh_connection##* }"
  fi
  ssh_port="${ssh_port:-22}"

  log "Проверяю DNS"
  if [ "$(resolve_ipv4 "${domain}")" != "${public_ip}" ]; then
    die "A-запись ${domain} ещё не указывает на ${public_ip}. Исправьте DNS и запустите файл снова."
  fi
  if [ "$(resolve_ipv4 "turn.${domain}")" != "${public_ip}" ]; then
    die "A-запись turn.${domain} ещё не указывает на ${public_ip}. TURN-поддомен должен быть DNS-only."
  fi

  log "Подготавливаю Docker, HTTPS, firewall и TURN"
  cd "${install_dir}"
  BOROTALK_SSH_PORT="${ssh_port}" bash deploy/scripts/prepare-vps.sh "${domain}" "${admin_email}"

  set_env_value PUBLIC_BASE_URL "https://${domain}"
  set_env_value ALLOWED_ORIGINS "https://${domain}"
  set_env_value TURN_HOST "turn.${domain}"
  set_env_value TURN_EXTERNAL_IP "${public_ip}"
  set_env_value SMTP_HOST "${smtp_host}"
  set_env_value SMTP_PORT "${smtp_port}"
  set_env_value SMTP_USERNAME "${smtp_username}"
  set_env_value SMTP_PASSWORD "${smtp_password}"
  set_env_value SMTP_FROM_EMAIL "${smtp_from_email}"
  set_env_value SMTP_FROM_NAME "${smtp_from_name}"
  set_env_value SMTP_STARTTLS "true"
  set_env_value TELEGRAM_BOT_TOKEN "${telegram_bot_token}"
  set_env_value TELEGRAM_BOT_USERNAME "${telegram_bot_username}"
  set_env_value BOOTSTRAP_ADMIN_EMAIL "${admin_email}"
  set_env_value OFFICIAL_DESKTOP_HOST "https://${domain}"

  log "Запускаю Borotalk"
  SKIP_GIT_SYNC=1 bash deploy/scripts/deploy-stack.sh production

  log "Проверяю установку"
  run_check
  cat <<EOF

Готово.

1. Откройте https://${domain}/register.html
2. Зарегистрируйтесь с email ${admin_email} без инвайт-кода.
3. Нажмите ссылку подтверждения из письма.
4. Войдите — этот первый аккаунт станет администратором.
5. Откройте «Настройки» → «Заявки» → «Подключить Telegram».

Повторная проверка:
  sudo bash ${install_dir}/INSTALL_VPS.sh --check

EOF
  if [ -d "${install_dir}/.git" ]; then
    cat <<EOF

Безопасное обновление:
  sudo bash ${install_dir}/INSTALL_VPS.sh --update
EOF
  else
    cat <<'EOF'

Эта установка создана из самодостаточного bundle. Для обновления загрузите
новый Borotalk-VPS-Installer.run после выхода следующей версии.
EOF
  fi
}

require_root
case "${mode}" in
  install|"")
    install_borotalk
    ;;
  --check)
    run_check
    ;;
  --update)
    run_update
    ;;
  *)
    die "Использование: sudo bash INSTALL_VPS.sh [--check|--update]"
    ;;
esac
