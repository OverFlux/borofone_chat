# Borofone_chat | Here readme lol ( ͡° ͜ʖ ͡°)

*A simple chat implemented within: FastApi, Redis, Postgres, Docker and SQLAlchemy.*

## Setup

1) First of all: Rename `.env.example` to `.env`
2) I haven't figured it out yet, maybe touch the grass..

## Project structure

```text
borofone_chat/
├── app/                        
│   ├── api/                   
│   │   ├── http.py             # REST API endpoints
│   │   └── ws.py               # WebSocket and connection management logic
│   ├── infra/                  
│   │   ├── db.py               # SQLAlchemy database configuration (Async)
│   │   └── redis.py            # Redis configuration and client
│   ├── main.py                 # Точка входа: инициализация FastAPI и роутинга
│   ├── models.py               # SQLAlchemy модели (схема базы данных)
│   ├── settings.py             # Управление настройками через Pydantic Settings
│   └── messages.py             # Бизнес-логика и CRUD операции с сообщениями
├── .env.example                
├── docker-compose.yml          # Полное окружение (API + DB + Redis), not tested!
├── docker-compose.infra.yml    # Локальная инфраструктура (DB + Redis)
├── requirements.txt            
└── README.md                  
```

### Main components

`api/` - содержит логику взаимодействия с клиентом.  

В **ws.py** реализован `ConnectionManager`, который изолирует логику рассылки сообщений от протокола WebSocket.

`infra/` - отвечает за технические детали подключения к внешним ресурсам.  

Здесь настраивается асинхронный движок базы данных и параметры пула соединений.

`messages.py` - вспомогательные функции для работы с данными. Здесь реализована логика обработки сообщений (например, проверка на дубликаты и сохранение в базу)

`docker-compose.infra.yml` — конфиг для разработки, позволяющий запускать только PostgreSQL-БД и Radis-кэш в контейнерах, оставляя само API на хост-машине для удобной отладки.

## Usefull commands

*You'll definitely find this useful, I'd think about it. :3*

### Docker & Infrastructure

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

### Application

**Start api:**

```bash
uvicorn app.main:app --reload --port 8000
```

### SQL Debug Queries

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

## Sources

Gitbook: <https://qqracha.gitbook.io/qqracha-docs/vKWuRLooKQWdYTCfU3pv>
