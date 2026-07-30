"""Small Redis-backed fixed-window limits for public authentication endpoints."""

from __future__ import annotations

import logging
import hashlib

from fastapi import HTTPException, Request, status
from redis.exceptions import RedisError

from app.infra.redis import get_redis_client, redis_key


logger = logging.getLogger(__name__)


async def enforce_auth_limit(
    request: Request,
    scope: str,
    *,
    limit: int,
    window_seconds: int,
    identifier: str = "",
) -> None:
    client_ip = request.client.host if request.client else "unknown"
    normalized_identifier = identifier.strip().lower()
    identifier_digest = (
        hashlib.sha256(normalized_identifier.encode("utf-8")).hexdigest()[:24]
        if normalized_identifier
        else ""
    )
    keys = [redis_key("rate", "auth", scope, "ip", client_ip)]
    if identifier_digest:
        keys.append(redis_key("rate", "auth", scope, "identity", identifier_digest))
    try:
        redis = get_redis_client()
        for key in keys:
            count = await redis.incr(key)
            if count == 1:
                await redis.expire(key, window_seconds)
            if count > limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many attempts. Try again later.",
                )
    except HTTPException:
        raise
    except (RedisError, OSError) as exc:
        # Authentication remains available during a short Redis outage; Nginx
        # provides a second rate-limit layer in production.
        logger.warning("Auth rate limiter unavailable: %s", exc)
