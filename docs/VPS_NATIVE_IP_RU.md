# Borotalk на VPS без домена

Этот профиль предназначен для небольшого VPS, где уже работают VPN и другие
сервисы. Borotalk запускается нативно, без Docker, не включает firewall и не
трогает глобальный `nginx.service`.

Публичный адрес на первом этапе имеет вид `https://203.0.113.10`. Для IP
выпускается доверенный короткоживущий сертификат Let's Encrypt, а его проверка
обновления выполняется дважды в сутки.

## Перед установкой

1. Создайте полный snapshot VPS в панели провайдера.
2. Убедитесь, что свободны TCP `80`, TCP `443`, UDP `443`, TCP/UDP `3478`, TCP
   `5349` и UDP `61000–61100`.
3. Подготовьте Resend API key и Telegram bot token. Не вставляйте их в команды,
   историю shell, Git или сообщения — установщик запросит их скрытым вводом.
4. На диске должно быть не менее 4 ГБ свободного места.

## Установка одним файлом

Скачайте `Borotalk-VPS-Native-Installer.run` из нужного GitHub Release и
запустите:

```bash
curl -fL \
  https://github.com/OverFlux/borofone_chat/releases/latest/download/Borotalk-VPS-Native-Installer.run \
  -o /tmp/Borotalk-VPS-Native-Installer.run

sudo bash /tmp/Borotalk-VPS-Native-Installer.run
```

Установщик попросит подтвердить готовый snapshot словом `SNAPSHOT`, затем
запросит email владельца, Resend API key, Telegram bot token и username бота.
Если домен не указан через environment, будет автоматически выбран публичный
IPv4 VPS.

В IP-режиме используется тестовый отправитель `onboarding@resend.dev`. Resend
разрешает ему отправлять письма только владельцу аккаунта, поэтому этот режим
подходит для проверки регистрации владельца, но не для приглашения друзей.

Проверка состояния:

```bash
sudo bash /opt/borotalk/INSTALL_VPS_NATIVE.sh --check
```

## Что установщик изолирует

- API, outbox worker, Redis, Nginx и два TURN listener запускаются отдельными
  `borotalk-*` systemd units;
- PostgreSQL и Redis слушают только loopback;
- Nginx Borotalk имеет собственный конфиг, PID и логи;
- firewall, `x-ui`, xray и существующие Telegram-боты не изменяются;
- перед установкой записываются состояния защищённых сервисов; если они
  остановились или перезапустились, установка завершается;
- ежедневный `pg_dump` хранит три последние локальные копии.

## Переключение на домен позднее

Сначала создайте A-записи основного и TURN-домена на IPv4 VPS и дождитесь их
обновления. Отдельно подтвердите почтовый домен в Resend. Затем выполните:

```bash
sudo BOROTALK_EMAIL_FROM_EMAIL=noreply@mail.example.com \
  bash /opt/borotalk/INSTALL_VPS_NATIVE.sh \
  --switch-host talk.example.com
```

Команда выпускает обычный сертификат сразу для `talk.example.com` и
`turn.talk.example.com`, обновляет origin, TURN и Telegram webhook. База,
аккаунты, серверы и сообщения сохраняются. Из-за смены cookie-origin
пользователям потребуется один раз войти заново.

Если домен уже работает, его можно использовать сразу при первой установке:

```bash
sudo BOROTALK_PUBLIC_HOST=talk.example.com \
  bash /tmp/Borotalk-VPS-Native-Installer.run
```

## Обновление и журналы

```bash
sudo bash /tmp/Borotalk-VPS-Native-Installer.run --update
sudo journalctl -u borotalk-api -u borotalk-worker -n 150 --no-pager
sudo journalctl -u borotalk-turn -u borotalk-turn-udp443 -n 150 --no-pager
```

Секреты находятся только в `/etc/borotalk/borotalk.env` с правами `0640`.
После smoke-test перевыпустите временно переданные ключи и замените значения в
этом файле, затем перезапустите API и worker.
