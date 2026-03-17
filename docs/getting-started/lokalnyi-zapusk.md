# Локальный запуск

### Локальный запуск

Проект использует Postgres и Redis как инфраструктуру, а приложение поднимается как обычный FastAPI сервис.

### Инфраструктура

Подними инфраструктуру через docker compose (в репозитории есть отдельный infra compose).&#x20;

Пример:

* `docker compose -f deploy/docker/docker-compose.infra.yml up -d`
* проверь `GET /health` и что `redis: true` (если Redis доступен).&#x20;

### Приложение

Запусти приложение любым удобным способом (uvicorn/IDE).

На старте приложение создаёт таблицы через `Base.metadata.create_all`, а на shutdown закрывает Redis-клиент и dispose’ит SQLAlchemy engine.&#x20;
