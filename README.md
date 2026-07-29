# Borotalk

Voice-first приложение для небольших комнат до восьми участников. Borotalk
сосредоточен на голосовой связи, демонстрации экрана, простом текстовом чате и
личных диалогах.

## Что входит

- серверы с текстовыми и голосовыми каналами;
- поиск серверов и пользователей по ID;
- P2P-голос и демонстрация экрана через WebRTC;
- realtime-чат каналов и личных диалогов;
- светлая и тёмная Nova-темы;
- встроенные эмодзи и набор аватаров;
- Windows Desktop с `.borotalk`-инвайтом, certificate pinning, треем,
  системными уведомлениями и push-to-talk;
- одно-кнопочный Windows-хост через Radmin VPN.

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
- WebRTC — P2P voice и screen share;
- Electron — Windows Desktop, системный звук, PTT и интеграция с ОС.

WebSocket подключается как `/ws?server_id=<id>` и изолирует события выбранным
сервером. Сообщения создаются через REST; WebSocket доставляет realtime-события
и обслуживает voice/WebRTC signaling.

## Данные

Не удаляйте вручную `.env`, `uploads`, Docker volumes, PostgreSQL или файлы из
`ssl`. В них находятся аккаунты, аватары, сообщения, сертификат хоста и
локальные настройки подключения.
