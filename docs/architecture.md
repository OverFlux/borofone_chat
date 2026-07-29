# Архитектура

Borotalk рассчитан на небольшие voice-комнаты и использует один сервер-хост.

- FastAPI раздаёт web UI и обслуживает REST/WebSocket.
- PostgreSQL хранит пользователей, серверы, членство, каналы и сообщения.
- Redis используется для pub/sub, presence, rate limits и короткой
  nonce-дедупликации сообщений.
- WebRTC передаёт голос и screen share напрямую между участниками.
- Electron загружает UI с хоста и добавляет системный звук, PTT, трей,
  уведомления и certificate pinning.

Один клиент держит один WebSocket на выбранный сервер. REST- и realtime-доступ
проверяют членство, поэтому пользователь не подписывается на чужие серверы.

Сообщения создаются через REST. Событие затем публикуется в Redis; если Redis
недоступен, однопроцессный хост использует локальные активные WebSocket.

Desktop доверяет self-signed сертификату только для сохранённого origin и
совпадающего SHA-256 fingerprint. Renderer работает без Node.js, с
`contextIsolation`, sandbox и узким preload bridge.
