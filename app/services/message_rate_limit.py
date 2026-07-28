"""Small, user-friendly message rate limits with a local fallback."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict, deque

from fastapi import HTTPException, status
from redis.asyncio import Redis

from app.infra.redis import redis_key


MESSAGE_BURST_LIMIT = 8
MESSAGE_BURST_WINDOW_SECONDS = 10
MESSAGE_MINUTE_LIMIT = 40
MESSAGE_MINUTE_WINDOW_SECONDS = 60

_local_attempts: dict[int, deque[float]] = defaultdict(deque)
_local_lock = asyncio.Lock()


def _limit_error(retry_after: int) -> HTTPException:
    retry_after = max(1, retry_after)
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=f"Слишком много сообщений. Подождите {retry_after} сек.",
        headers={"Retry-After": str(retry_after)},
    )


async def _enforce_redis_limit(redis: Redis, user_id: int, now: float) -> None:
    limits = (
        (MESSAGE_BURST_WINDOW_SECONDS, MESSAGE_BURST_LIMIT),
        (MESSAGE_MINUTE_WINDOW_SECONDS, MESSAGE_MINUTE_LIMIT),
    )
    exceeded_after = 0
    for window_seconds, limit in limits:
        bucket = int(now // window_seconds)
        key = redis_key("rate", "messages", user_id, window_seconds, bucket)
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, window_seconds + 2)
        if count > limit:
            exceeded_after = max(
                exceeded_after,
                window_seconds - int(now % window_seconds),
            )
    if exceeded_after:
        raise _limit_error(exceeded_after)


async def _enforce_local_limit(user_id: int, now: float) -> None:
    async with _local_lock:
        attempts = _local_attempts[user_id]
        minute_start = now - MESSAGE_MINUTE_WINDOW_SECONDS
        while attempts and attempts[0] <= minute_start:
            attempts.popleft()

        burst_start = now - MESSAGE_BURST_WINDOW_SECONDS
        burst_count = sum(timestamp > burst_start for timestamp in attempts)
        if burst_count >= MESSAGE_BURST_LIMIT:
            retry_after = int(
                MESSAGE_BURST_WINDOW_SECONDS - (now - attempts[-burst_count])
            ) + 1
            raise _limit_error(retry_after)
        if len(attempts) >= MESSAGE_MINUTE_LIMIT:
            retry_after = int(
                MESSAGE_MINUTE_WINDOW_SECONDS - (now - attempts[0])
            ) + 1
            raise _limit_error(retry_after)

        attempts.append(now)


async def enforce_message_rate_limit(
    redis: Redis | None,
    user_id: int,
    *,
    now: float | None = None,
) -> None:
    """Apply Redis-backed limits and continue locally if Redis is unavailable."""
    timestamp = time.time() if now is None else now
    if redis is not None:
        try:
            await _enforce_redis_limit(redis, user_id, timestamp)
            return
        except HTTPException:
            raise
        except Exception:
            pass
    await _enforce_local_limit(user_id, timestamp)
