# Borotalk

Voice-first приложение для небольших комнат до восьми участников. Borotalk
сосредоточен на голосовой связи, демонстрации экрана, простом текстовом чате и
личных диалогах.

## Что входит

- серверы с текстовыми и голосовыми каналами;
- приватные серверы, публичные непрогнозируемые ID, инвайты и заявки;
- P2P-голос и демонстрация экрана через WebRTC с TURN fallback;
- realtime-чат каналов и личных диалогов;
- светлая и тёмная Nova-темы;
- встроенные эмодзи и набор аватаров;
- Windows Desktop с `.borotalk`-инвайтом, certificate pinning, треем,
  системными уведомлениями и push-to-talk;
- одно-кнопочный Windows-хост через Radmin VPN;
- VPS-режим с доменом, email-подтверждением и одобрением через Telegram.

В проекте нет MongoDB, вложений, игр, GIF/sticker-каталогов и старого интерфейса.

## Запуск хоста на Windows

1. Установите Docker Desktop и Radmin VPN.
2. Запустите `START_BOROTALK.bat`.
3. Дождитесь строки с адресом `https://26.x.x.x:8443`.
4. Передайте друзьям папку `BOROTALK_SHARE` или файл
   `Borotalk-connect.borotalk`.

Локальные страницы:

- `/` — лендинг;
- `/login.html` и `/register.html` — авторизация;
- `/main.html` — приложение.

Для полной остановки используйте `STOP_BOROTALK.bat`.

## VPS с собственным доменом

### Небольшой или уже используемый VPS

Для VPS с 1 ГБ RAM и уже работающими сервисами используйте изолированный
нативный установщик без Docker. Он запускает Borotalk отдельными systemd-unit,
не включает firewall и не использует глобальный `nginx.service`:

```bash
curl -fL \
  https://github.com/OverFlux/borofone_chat/releases/latest/download/Borotalk-VPS-Native-Installer.run \
  -o /tmp/Borotalk-VPS-Native-Installer.run
sudo bash /tmp/Borotalk-VPS-Native-Installer.run
```

Он поддерживает временный запуск по публичному IPv4, Resend Python API,
PostgreSQL outbox, собственный TURN и последующее переключение на домен без
потери данных. Пошаговая инструкция: [docs/VPS_NATIVE_IP_RU.md](docs/VPS_NATIVE_IP_RU.md).

Проверка уже установленного экземпляра:

```bash
sudo bash /opt/borotalk/INSTALL_VPS_NATIVE.sh --check
```

### Docker-профиль

Подробная инструкция для установки с нуля:
[docs/VPS_INSTALL_RU.md](docs/VPS_INSTALL_RU.md).

Для Ubuntu/Debian с публичным IPv4 сначала направьте A-записи основного домена
и `turn.<домен>` на VPS, затем выполните:

```bash
sudo bash INSTALL_VPS.sh
```

Интерактивный установщик спросит домен, email владельца, реквизиты внешнего
SMTP и Telegram-бота, после чего выполнит остальную установку. Проверить или
обновить уже установленный сервер можно тем же файлом:

```bash
sudo bash /opt/borotalk/INSTALL_VPS.sh --check
sudo bash /opt/borotalk/INSTALL_VPS.sh --update
```

Ручной вариант остаётся доступен:

```bash
sudo bash deploy/scripts/prepare-vps.sh talk.example.com owner@example.com
```

### Локальная симуляция VPS на Windows

Запустите `TEST_VPS_LOCAL.bat`. Он поднимет изолированные PostgreSQL, Redis,
API, outbox worker и Mailpit, затем откроет:

- `http://127.0.0.1:8080` — локальный Borotalk;
- `http://127.0.0.1:8025` — почтовый ящик для подтверждений и reset-ссылок.

Первый администратор регистрируется с `owner@example.com` без инвайта.
Остановка — `STOP_VPS_LOCAL.bat`; база сохраняется и не пересекается с обычным
Radmin-запуском. `RESET_VPS_LOCAL.bat` удаляет только данные локального стенда
после явного ввода `RESET`.

Скрипт подготавливает Docker, Nginx, Certbot, firewall, TLS и `.env`. Перед
первым deploy заполните в `.env` внешний SMTP, Telegram bot token/username и
`BOOTSTRAP_ADMIN_EMAIL`, затем:

```bash
bash deploy/scripts/deploy-stack.sh production
```

Первый аккаунт с `BOOTSTRAP_ADMIN_EMAIL` становится администратором только
после подтверждения email. После входа Telegram привязывается в настройках
одноразовой ссылкой. Для внешней копии backup укажите `BACKUP_RCLONE_REMOTE`.
Подготовка VPS также включает systemd timers: health-check каждые пять минут,
ежедневный backup и еженедельную пробную загрузку последней копии в
изолированную временную PostgreSQL.

### Radmin одновременно с AmneziaVPN

Лаунчер закрепляет сеть `26.0.0.0/8` за адаптером Radmin и создаёт отдельное
исходящее firewall-правило. Та же коррекция доступна вручную через
`FIX_RADMIN_ROUTE.bat`; файл автоматически попадает в `BOROTALK_SHARE`.

Если AmneziaVPN продолжает блокировать соединение, добавьте `26.0.0.0/8` в
IP split tunneling в режиме «адреса из списка не через VPN», затем
переподключите AmneziaVPN. При включённом KillSwitch его также потребуется
отключить: это фильтр самого VPN-клиента, который не обходится обычным
маршрутом Windows.

## Desktop

Исходники клиента находятся в `desktop/`.

```powershell
cd desktop
npm ci
npm test
npm run make
```

Установщик и portable ZIP создаются в `desktop/out/make/`. Сборка пока не
подписана, поэтому Windows SmartScreen может показать предупреждение.

## Локальная разработка

```powershell
docker compose -f deploy/docker/docker-compose.infra.yml up -d
python -m alembic upgrade head
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

После запуска откройте `http://127.0.0.1:8000/`.

## Проверки

```powershell
python -m pytest
node --check pages/js/nova-main.js
node --check pages/js/message-format.mjs
cd desktop
npm test
npm run make
```

## Архитектура

- FastAPI — REST, WebSocket и раздача web-интерфейса;
- PostgreSQL — пользователи, серверы, каналы и сообщения;
- Redis — realtime pub/sub, presence, rate limits и nonce-дедупликация;
- PostgreSQL outbox worker — надёжная доставка SMTP и Telegram;
- WebRTC — P2P voice и screen share, coturn — резерв для сложного NAT;
- Electron — Windows Desktop, системный звук, PTT и интеграция с ОС.

WebSocket подключается как `/ws?server_id=<id>` и изолирует события выбранным
сервером. Сообщения создаются через REST; WebSocket доставляет realtime-события
и обслуживает voice/WebRTC signaling.

## Данные

Не удаляйте вручную `.env`, `uploads`, Docker volumes, PostgreSQL или файлы из
`ssl`. В них находятся аккаунты, аватары, сообщения, сертификат хоста и
локальные настройки подключения.
