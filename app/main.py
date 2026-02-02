import asyncio
from contextlib import asynccontextmanager

from asgi_lifespan import LifespanManager
from fastapi import FastAPI

from app.infra.db import engine
from app.infra.redis import redis_client
from app.models import Base
from app.api.http import router as http_router
from app.api.ws import router as ws_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrations are applied manually via alembic upgrade
    # All the code before yield is executed before the application starts,
    # the part after yield is executed when the server is shut down.
    yield

    # Shutdown
    await redis_client.aclose() # Close Redis клиента
    await engine.dispose() # Close connection pool with SQLAlchemy

app = FastAPI(lifespan=lifespan)

@app.get("/")
async def root():
    return {"ok": True} # Stub for quickly testing API startup

app.include_router(http_router, tags=["HTTP"]) # Add a router with HTTP endpoints
app.include_router(ws_router, tags=["Websocket"]) # Add a router with WebSockets endpoints
