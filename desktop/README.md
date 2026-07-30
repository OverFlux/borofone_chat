# Borotalk Desktop

Windows 10/11 x64-клиент на Electron. Он загружает интерфейс с выбранного
Borotalk-хоста, поэтому использует те же cookie, REST, WebSocket и WebRTC, что и
браузерная версия.

## Локальный запуск

```powershell
npm ci
npm start
```

На экране подключения можно выбрать или перетащить
`Borotalk-connect.borotalk`, либо указать HTTPS origin вручную. Файл генерируется
хостом при запуске `START_BOROTALK.bat`.

Постоянный VPS-домен задаётся полем `borotalk.officialHost` в `package.json`
перед сборкой. Тогда Desktop открывает его автоматически, а смена хоста остаётся
в расширенных настройках. Локально это можно сделать командой:

```powershell
npm pkg set borotalk.officialHost="https://talk.example.com"
```

В GitHub Actions тот же адрес берётся из repository variable
`BOROTALK_OFFICIAL_HOST`.

## Проверка и сборка

```powershell
npm test
npm run make
```

Forge создаёт unsigned Squirrel installer и portable ZIP в `out/make/`.
SmartScreen на чистом компьютере может предупредить о неизвестном издателе.

## Границы безопасности

- `nodeIntegration` выключен, `contextIsolation` и renderer sandbox включены.
- Preload предоставляет только ограниченный `window.borotalkDesktop`.
- Навигация, разрешения и self-signed сертификат привязаны к одному сохранённому origin.
- После первого доверия изменение SHA-256 fingerprint блокирует соединение.
- Глобальный hook запускается только при включённом push-to-talk и обрабатывает
  только назначенную клавишу или боковую кнопку мыши.
- При ошибке hook микрофон переводится в mute.

Формат файла подключения v1:

```json
{
  "schema_version": 1,
  "base_url": "https://26.x.x.x:8443",
  "invite_code": "boro-…",
  "certificate_sha256": "…"
}
```

V2 для домена с публичным TLS:

```json
{
  "schema_version": 2,
  "base_url": "https://talk.example.com",
  "invite_code": "boro-…",
  "certificate_policy": "system"
}
```

Для self-hosted v2 используется `certificate_policy: "pinned"` вместе с
`certificate_sha256`. Чтение v1 сохраняется.
