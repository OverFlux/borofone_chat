Here readme lol ( ͡° ͜ʖ ͡°)

1) First of all: Rename `.env.example` to `.env`


Check docker health - `docker compose -f docker-compose.infra.yml ps`

Start api - `uvicorn app.main:app --reload --port 8000`

Enter in psql - `docker compose -f docker-compose.infra.yml exec postgres psql -U app -d app`

UP infra - `docker compose -f docker-compose.infra.yml up -d`

DOWN infra - `docker compose -f docker-compose.infra.yml down`

For DB ROOMS - `SELECT id, title FROM rooms ORDER BY id DESC LIMIT 150;`

For DB messages - `SELECT id, room_id, author, body, nonce, created_at FROM messages ORDER BY id DESC LIMIT 50;`

Clear all DB safety - `TRUNCATE TABLE messages, rooms RESTART IDENTITY CASCADE;`

gitbook: https://qqracha.gitbook.io/qqracha-docs/vKWuRLooKQWdYTCfU3pv