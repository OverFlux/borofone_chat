import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.infra.db import engine
from app.infra.redis import redis_client
from app.models import Base
from app.api.http import router as http_router
from app.api.ws import router as ws_router

# Нужно исправить этот костыль на Alembic миграцию
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Вся часть кода до yield выполняется до запуска приложения, часть после yield при выключении сервера.
    last_exc = None
    for _ in range(30): # 30 попыток подключения к бд
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all) # TODO: Миграция Alembic
            break
        except Exception as e:
            last_exc = e
            await asyncio.sleep(1)
    else:
        raise last_exc

    yield

    # shutdown
    await redis_client.aclose() # Закрытие Redis клиента
    await engine.dispose() # Закрытие connection pool с SQLAlchemy

app = FastAPI(lifespan=lifespan)

@app.get("/")
async def root():
    return {"ok": True} # Заглушка для быстрой проверки запуска API

app.include_router(http_router) # Добавляем роутер с HTTP эндпоинтами
app.include_router(ws_router) # Добавляем роутер с WebSockets эндпоинтами
