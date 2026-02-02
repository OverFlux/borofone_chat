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

## Sources

Gitbook: <https://qqracha.gitbook.io/qqracha-docs/vKWuRLooKQWdYTCfU3pv>
