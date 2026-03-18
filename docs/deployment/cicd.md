# CI/CD Deployment

## Overview

Production and staging run in Docker Compose only.
The API is no longer started by systemd services during normal deploys.

Environment mapping:

- `main` -> production
- `dev` -> staging

Persistent runtime data lives outside the git checkout:

- production: `/var/lib/borofone/production`
- staging: `/var/lib/borofone/staging`
- backups: `/var/backups/borofone`

Each environment must define:

- `HOST_DATA_ROOT`
- `BACKUP_ROOT`

## Deploy flow

GitHub Actions connects over SSH and runs:

```bash
bash deploy/scripts/deploy-stack.sh production
```

or:

```bash
bash deploy/scripts/deploy-stack.sh staging
```

The deploy script performs:

1. git sync for the target branch
2. backup of database, uploads, leaderboard, and `.env`
3. one-time migration of legacy uploads volume and repo-local leaderboard files into host storage
4. compose config preflight validation
5. startup and health checks for Postgres and Redis
6. API image build
7. Alembic migrations
8. API recreation and health verification

## First rollout / cutover

On the first rollout after introducing this flow:

1. Ensure `.env` exists in `/opt/borofone-chat-prod` and `/opt/borofone-chat-staging`.
2. Set `HOST_DATA_ROOT` and `BACKUP_ROOT` to absolute host paths.
3. Run the deploy once.

During the first deploy, `prepare-persistent-data.sh` will:

- create host-backed directories for uploads and leaderboard
- migrate uploads from the legacy Docker volume if the new target is empty
- migrate repo-local leaderboard files if the new target is empty
- write a migration marker file under `HOST_DATA_ROOT`
- stop, disable, and mask legacy `borofone-prod` / `borofone-staging` systemd units if present

Legacy Docker volumes are kept in place for rollback safety.

## Operational notes

- Do not use `docker compose down` for normal application updates.
- Do not store runtime user files inside the repository checkout.
- Deploy scripts auto-detect `docker compose` and fall back to `docker-compose` when needed.
- Reverse proxy remains in nginx and continues to target `127.0.0.1:8000` and `127.0.0.1:8001`.
