import sys
from collections.abc import AsyncGenerator
from pathlib import Path

import httpx
import pytest_asyncio
from asgi_lifespan import LifespanManager

from app.main import app

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


@pytest_asyncio.fixture(scope="session")
async def ac() -> AsyncGenerator[httpx.AsyncClient, None]:
    # Важно: lifespan должен стартовать 1 раз на сессию, потому что в твоём lifespan
    # на shutdown вызывается engine.dispose() и redis_client.aclose(). [file:7]
    async with LifespanManager(app) as manager:
        transport = httpx.ASGITransport(app=manager.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
