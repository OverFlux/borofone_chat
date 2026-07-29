# API и realtime

Основные группы REST:

- `/auth/*` — регистрация, вход, refresh, профиль и выход;
- `/servers/*` — серверы, членство и роли;
- `/rooms/*` — текстовые каналы и сообщения;
- `/voice-rooms/*` — голосовые каналы;
- `/direct-conversations/*` — личные диалоги;
- `/api/emoji` — встроенный список эмодзи.

WebSocket:

```text
/ws?server_id=<server id>
```

Клиент отправляет `ping`, `typing`, voice presence и `rtc_offer`,
`rtc_answer`, `rtc_ice`. Сервер доставляет сообщения, личные события,
presence и WebRTC signaling только членам выбранного сервера.

Текстовые сообщения ограничены 2000 символами и защищены мягким rate limit.
Клиент передаёт nonce, а сервер дедуплицирует повторную отправку в коротком
Redis TTL-окне.
