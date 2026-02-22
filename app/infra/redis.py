"""
Redis configuration with proper connection pooling.

Fixes:
1. Правильный connection pool
2. Ограничение max_connections
3. Graceful handling при исчерпании connections
"""
from typing import AsyncGenerator

from redis.asyncio import Redis, ConnectionPool
from redis.exceptions import RedisError, ConnectionError as RedisConnectionError

from app.settings import settings

# ==========================================
# CONNECTION POOL
# ==========================================

pool = ConnectionPool.from_url(
    settings.redis_url,
    decode_responses=True,  # Автоматически декодировать bytes → str
    max_connections=100,    # Увеличено для множества пользователей
    socket_connect_timeout=5,
    socket_timeout=5,
    socket_keepalive=True,
    socket_keepalive_options={
        1: 1, # TCP_KEEPIDLE
        2: 1, # TCP_KEEPINTVL
        3: 3, # TCP_KEEPCNT
    },
    retry_on_timeout=True,
    health_check_interval=30,
)

# ==========================================
# GLOBAL CLIENT (для использования вне FastAPI)
# ==========================================

redis_client: Redis | None = None

try:
    redis_client = Redis(connection_pool=pool)
except Exception as e:
    print(f"⚠️ Warning: Could not create Redis client: {e}")
    redis_client = None

# ==========================================
# DEPENDENCY
# ==========================================

async def get_redis() -> AsyncGenerator[Redis | None, None]:
    """
    FastAPI dependency для получения Redis client.

    Graceful degradation: возвращает None если Redis недоступен.
    """
    if redis_client is None:
        yield None
        return

    try:
        # Проверяем соединение
        await redis_client.ping()
        yield redis_client
    except RedisError as e:
        print(f"⚠️ Redis unavailable: {e}")
        yield None


async def get_redis_required() -> AsyncGenerator[Redis, None]:
    """
    FastAPI dependency для Redis (требует доступности).

    Raises HTTPException если Redis недоступен.
    """
    from fastapi import HTTPException, status

    if redis_client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis service unavailable"
        )

    try:
        await redis_client.ping()
        yield redis_client
    except RedisError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Redis connection failed: {str(e)}"
        )


# ==========================================
# HELPER FUNCTIONS
# ==========================================

async def check_redis_health() -> bool:
    """Проверка здоровья Redis."""
    if redis_client is None:
        return False

    try:
        await redis_client.ping()
        return True
    except RedisError:
        return False


async def close_redis():
    """Закрытие Redis соединений."""
    if redis_client:
        await redis_client.close()

    if pool:
        await pool.disconnect()


async def clear_redis():
    """Очистка всех ключей в Redis (только для тестов!)."""
    if redis_client:
        await redis_client.flushdb()


async def get_redis_info() -> dict:
    """Получение информации о Redis."""
    if redis_client is None:
        return {"status": "unavailable"}

    try:
        info = await redis_client.info()
        return {
            "status": "healthy",
            "connected_clients": info.get("connected_clients", 0),
            "used_memory_human": info.get("used_memory_human", "unknown"),
            "uptime_in_seconds": info.get("uptime_in_seconds", 0),
        }
    except RedisError as e:
        return {
            "status": "error",
            "error": str(e)
        }
