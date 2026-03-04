# Borofone_chat | Here readme lol ( ͡° ͜ʖ ͡°)

*A simple chat implemented within: FastApi, Redis, Postgres, Docker and SQLAlchemy.*

## !! Setup

### 1. Установить зависимости

```bash
pip install -r requirements.txt
```
### 2. Поднять бд и редис

```bash
docker compose -f docker-compose.infra.yml up -d
```

### 3. Применить миграции
```bash
alembic upgrade head
```
!! **Ожидается** `001_baseline (head)` !! | 10.02 snapshot
```bash
alembic current
```
### 4. Запустить приложение

```bash
uvicorn app.main:app --reload
```

### run with venv!

```bash
.\scripts\start_https.bat
```

### 5. Подготовка данные

- Зарегистрировать инвайт-код в БД

- Создать комнату

- При необходимости выдать пользователю права: role -> admin

- При проблемах с uploads - создать директорию /uploads/avatars

## Project structure

```text
borofone_chat/
├── app/                        
│   ├── api/                   
│   │   ├── http.py             # REST API handlers (Request processing).
│   │   └── ws.py               # WebSocket and connection management logic
│   ├── infra/                  
│   │   ├── db.py               # SQLAlchemy database configuration (Async)
│   │   └── redis.py            # Redis configuration and client
│   ├── schemas/
│   │   └── *.py                # Pydantic scheme for validating a specific section
│   ├── services/
│   │   └── messages.py         # Logic for sending messages and CRUD operations
│   ├── __init__.py    
│   ├── main.py                 # Entry Point: Initializing FastAPI and Routing
│   ├── models.py               # SQLAlchemy models (database schema)
│   ├── settings.py             # Managing settings via Pydantic Settings
├── .env.example                
├── docker-compose.yml          # Full environment (API + DB + Redis), not tested!
├── docker-compose.infra.yml    # Local infrastructure (DB + Redis)
├── requirements.txt            
└── README.md                  
```

### // Main components

`api/` - contains the logic of interaction with the client. 

**ws.py** implements `ConnectionManager`, which isolates the message sending logic from the WebSocket protocol.

`infra/` - is responsible for the technical details of connecting to external resources.

This is where you configure the asynchronous database engine and connection pool settings.

`services/messages.py` - functions for working with data. This is where the message processing logic is implemented (for example, checking for duplicates and saving to the database).

`docker-compose.infra.yml` — development config that allows you to run only the PostgreSQL database and Radis cache in containers, leaving the API itself on the host machine for easy debugging.

## Usefull commands

*You'll definitely find this useful, I'd think about it. :3*

### // Docker & Infrastructure

**Check docker health:**
  
```bash
docker compose -f docker-compose.infra.yml ps
```

**UP infra:**

```bash
docker compose -f docker-compose.infra.yml up -d
```

**DOWN infra:**

```bash
docker compose -f docker-compose.infra.yml down
```

**Enter in psql:**

```bash
docker compose -f docker-compose.infra.yml exec postgres psql -U app -d app
```

### // Application

**Start api:**

```bash
uvicorn app.main:app --reload --port 8000
```

### // SQL Debug Queries

**Select Rooms:**

```sql
SELECT id, title FROM rooms ORDER BY id DESC LIMIT 150;
```

**Select Messages:**

```sql
SELECT id, room_id, author, body, nonce, created_at FROM messages ORDER BY id DESC LIMIT 50;
```

**Clear all DB (safety):**

```sql
TRUNCATE TABLE messages, rooms RESTART IDENTITY CASCADE;
```

### // Alembic migration

**Current migration version:**

```bash
alembic current
```

**Create new version migration:**

```bash
alembic revision --autogenerate -m "sample_text"
```

**Upgrade to new migration version:**

```bash
alembic upgrade head
```

**Downgrade to 1 step down migration version:**

```bash
alembic downgrade -1
```

**View migration history:**

```bash
alembic history --verbose
```

**View the following migrations to apply:**

```bash
alembic heads
```

## TODO

- [x] Logout in settings
- [ ] User was connected to room
- [x] Голосовой чат
- [x] ctrl+v вложения
- [x] Кастомные уведомления
- [x] Реакции
- [x] Реплай
- [x] Маркдаун в сообщениях
- [x] Кастомные темы
- [ ] Фавикон
- [ ] Пофиксить отображение аватарок в чате
- [x] Закругление углов у картинок
- [x] Исправить отображение онлайн пользователей
- [x] Исправить дизайн панель войсчата
- [ ] Статус оффлайн
- [ ] Глобальное удаление сообщений
- [ ] Нормальный шумодав для войсчата
- [ ] Нью смайлы
- [x] Amoled тема
- [ ] Демонстрация экрана
- [ ] Лимиты на сообщения
- [x] Исправить баг с отправлением вложений, спам много-за-раз
- [ ] Верстка для телефона
- [ ] Интеграция с гиффи для гифок, дискорд ah
- [x] Добавить Wordle
- [ ] Отображение аватарок в войсчате
- [ ] Бинд для мута
- [ ] Пофиксить разлогин при долгой сессии на сайте
- [ ] Исправить отображение онлайн пользователей 

## 🔐 HTTPS для Radmin VPN (Voice Chat)

Для работы голосового чата через Radmin VPN требуется HTTPS, так как `getUserMedia()` работает только в защищённом контексте.

### Шаг 1: Генерация SSL сертификата

Открой PowerShell **от имени администратора**:

```powershell
.\scripts\generate_ssl.ps1
```

Скрипт создаст:
- `ssl/voice.pfx` - PFX сертификат
- `ssl/cert.pem` - Сертификат в PEM формате
- `ssl/key.pem` - Приватный ключ (требуется OpenSSL)
- `ssl/cert.crt` - Публичный сертификат для друзей

### Шаг 2: Запуск HTTPS сервера

```bash
# Требуется запуск от имени администратора (порт 443)
python run_https.py
```

Или с кастомными параметрами:

```bash
python run_https.py --host 0.0.0.0 --port 443 --cert ssl/cert.pem --key ssl/key.pem
```

### Шаг 3: Настройка для друзей

Друзьям нужно добавить сертификат в доверенные:

**Windows:**
1. Открыть `ssl/cert.crt`
2. Нажать "Установить сертификат"
3. Выбрать "Локальный компьютер" → "Поместить в следующее хранилище"
4. Выбрать "Доверенные корневые центры сертификации"

**Chrome/Edge:**
1. На браузере: `chrome://settings/certificates`
2. Import → выбрать `cert.crt`
3. Выбрать "Trusted Root Certification Authorities"

### Шаг 4: Подключение

Друзья заходят по адресу:
```
https://26.150.183.241/
```

⚠️ **Важно:** IP-адрес Radmin VPN может меняться. Обнови `.env`:
```
RADMIN_IP=твой_новый_ip
```

### Альтернатива: mkcert (рекомендуется)

Если установлен [mkcert](https://github.com/FiloSottile/mkcert):

```bash
mkcert -install
mkcert "yourip" localhost
```

Это создаст сертификаты, которые будут автоматически доверяться браузером.

maybe next time

## Sources

Gitbook: <https://qqracha.gitbook.io/qqracha-docs/vKWuRLooKQWdYTCfU3pv>
