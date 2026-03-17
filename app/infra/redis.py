"""
Redis configuration with proper connection pooling.

Fixes:
1. Правильный connection pool
2. Ограничение max_connections
3. Graceful handling при исчерпании connections
4. Исправлены настройки socket_keepalive
"""
from typing import AsyncGenerator
import logging

from redis.asyncio import Redis, ConnectionPool
from redis.exceptions import RedisError, ConnectionError as RedisConnectionError
from redis.backoff import ExponentialBackoff
from redis.retry import Retry

from app.settings import settings

logger = logging.getLogger(__name__)


def redis_namespace_prefix() -> str:
    return f'borofone:{settings.runtime_namespace}'


def redis_key(*parts: object) -> str:
    suffix = ':'.join(str(part) for part in parts if part is not None and str(part) != '')
    return f'{redis_namespace_prefix()}:{suffix}' if suffix else redis_namespace_prefix()


def room_events_channel(room_id: int) -> str:
    return redis_key('room', room_id, 'events')


def room_presence_key(room_id: int) -> str:
    return redis_key('room', room_id, 'online')

# ==========================================
# CONNECTION POOL - создаётся лениво
# ==========================================

_pool: ConnectionPool | None = None

def get_connection_pool() -> ConnectionPool:
    """Ленивое создание пула подключений."""
    global _pool
    if _pool is None:
        _pool = ConnectionPool.from_url(
            settings.redis_url,
            decode_responses=True,
            max_connections=50,
            socket_connect_timeout=5,      # 5 seconds connection timeout
            socket_timeout=5,              # 5 seconds socket timeout
            socket_keepalive=True,
            retry_on_timeout=True,
            health_check_interval=30,
            # Retry configuration - reduce retries to avoid delays
            retry=Retry(
                ExponentialBackoff(cap=2, base=0.5),
                retries=3
            ),
            # Отключаем проблемные опции
            retry_on_error=[],
        )
        logger.info(f"Redis connection pool created: {settings.redis_url}")
    return _pool

# ==========================================
# GLOBAL CLIENT
# ==========================================

redis_client: Redis | None = None

def get_redis_client() -> Redis:
    """Получение Redis клиента с ленивой инициализацией."""
    global redis_client
    if redis_client is None:
        redis_client = Redis(connection_pool=get_connection_pool())
        logger.info("Redis client created")
    return redis_client

# Инициализация при импорте
try:
    get_redis_client()
except Exception as e:
    logger.warning(f"⚠️ Warning: Could not create Redis client at startup: {e}")
    redis_client = None

# ==========================================
# DEPENDENCY
# ==========================================

async def get_redis() -> AsyncGenerator[Redis | None, None]:
    """
    FastAPI dependency для получения Redis client.

    Graceful degradation: возвращает None если Redis недоступен.
    """
    client = get_redis_client()
    if client is None:
        yield None
        return

    try:
        # Проверяем соединение
        await client.ping()
        yield client
    except RedisError as e:
        logger.warning(f"⚠️ Redis unavailable: {e}")
        yield None


async def get_redis_required() -> AsyncGenerator[Redis, None]:
    """
    FastAPI dependency для Redis (требует доступности).

    Raises HTTPException если Redis недоступен.
    """
    from fastapi import HTTPException, status

    client = get_redis_client()
    if client is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Redis service unavailable"
        )

    try:
        await client.ping()
        yield client
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
    client = get_redis_client()
    if client is None:
        return False

    try:
        await client.ping()
        return True
    except RedisError:
        return False


async def close_redis():
    """Закрытие Redis соединений."""
    global redis_client, _pool
    
    if redis_client:
        await redis_client.close()
        redis_client = None
    
    if _pool:
        await _pool.disconnect()
        _pool = None
    logger.info("Redis connections closed")


async def clear_redis():
    """Очистка всех ключей в Redis (только для тестов!)."""
    client = get_redis_client()
    if client:
        await client.flushdb()
        logger.warning("Redis flushed (test only)")


async def get_redis_info() -> dict:
    """Получение информации о Redis."""
    client = get_redis_client()
    if client is None:
        return {"status": "unavailable"}

    try:
        info = await client.info()
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
