import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.infra.db import engine
from app.infra.redis import redis_client
from app.models import Base
from app.api.http import router as http_router
from app.api.ws import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup (до приема запросов)
    last_exc = None
    for _ in range(30):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            break
        except Exception as e:
            last_exc = e
            await asyncio.sleep(1)
    else:
        raise last_exc

    yield

    # shutdown (перед остановкой приложения)
    await redis_client.aclose()
    await engine.dispose()

app = FastAPI(lifespan=lifespan)

@app.get("/")
async def root():
    return {"ok": True} # заглушка

app.include_router(http_router)
app.include_router(ws_router)
