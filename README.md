Here readme lol ( ͡° ͜ʖ ͡°)


Check docker health - `docker compose -f docker-compose.infra.yml ps`

Start api - `uvicorn app.main:app --reload --port 8000`

Enter in psql - `docker compose -f docker-compose.infra.yml exec postgres psql -U app -d app`
