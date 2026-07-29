"""Creation of text-channel messages with short-lived nonce deduplication."""
from __future__ import annotations

from fastapi import HTTPException
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.redis import get_redis_client, redis_key
from app.models import Message
from app.schemas.messages import MessageCreate

NONCE_TTL_SECONDS = 300
PENDING = "PENDING"


def _nonce_key(user_id: int, nonce: str) -> str:
    return redis_key("nonce", user_id, nonce)


async def create_message_with_nonce(
    db: AsyncSession,
    room_id: int,
    user_id: int,
    payload: MessageCreate,
    redis: Redis | None = None,
) -> Message:
    """Create one plain-text message and deduplicate retries by nonce."""

    async def create_message() -> Message:
        message = Message(
            room_id=room_id,
            user_id=user_id,
            body=payload.body,
            nonce=payload.nonce,
        )
        db.add(message)
        await db.commit()
        await db.refresh(message)
        return message

    async def find_existing() -> Message | None:
        result = await db.execute(
            select(Message).where(
                Message.user_id == user_id,
                Message.nonce == payload.nonce,
            )
        )
        return result.scalar_one_or_none()

    if payload.nonce is None:
        return await create_message()

    redis_client = redis if redis is not None else get_redis_client()
    if redis_client is None:
        existing = await find_existing()
        if existing:
            if payload.enforce_nonce:
                raise HTTPException(status_code=409, detail="nonce conflict")
            return existing
        return await create_message()

    key = _nonce_key(user_id, payload.nonce)
    try:
        acquired = await redis_client.set(
            key,
            PENDING,
            nx=True,
            ex=NONCE_TTL_SECONDS,
        )
        if not acquired:
            value = await redis_client.get(key)
            if value and value != PENDING:
                try:
                    result = await db.execute(
                        select(Message).where(Message.id == int(value))
                    )
                    existing = result.scalar_one_or_none()
                except (TypeError, ValueError):
                    existing = None
                if existing and not payload.enforce_nonce:
                    return existing
            if payload.enforce_nonce:
                raise HTTPException(status_code=409, detail="nonce conflict")

        try:
            message = await create_message()
        except Exception:
            await redis_client.delete(key)
            raise

        stored = await redis_client.set(
            key,
            str(message.id),
            xx=True,
            ex=NONCE_TTL_SECONDS,
        )
        if not stored:
            await redis_client.delete(key)
        return message
    except HTTPException:
        raise
    except Exception:
        existing = await find_existing()
        if existing:
            if payload.enforce_nonce:
                raise HTTPException(status_code=409, detail="nonce conflict")
            return existing
        return await create_message()
