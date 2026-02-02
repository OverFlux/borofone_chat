from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.redis import redis_client
from app.models import Message
from app.schemas.messages import MessageCreate

NONCE_TTL_SECONDS = 300
PENDING = "PENDING"


def _nonce_key(author: str, nonce: str) -> str:
    return f"nonce:{author}:{nonce}"

# Discord-like deduplication message by nonce, docs for more info.
async def create_message_with_nonce(
        db: AsyncSession,
        room_id: int,
        payload: MessageCreate,
) -> Message:

    # No nonce - no change
    if payload.nonce is None:
        msg = Message(
            room_id=room_id,
            author=payload.author,
            body=payload.body,
            nonce=None,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
        return msg

    # With nonce — check deduplication
    key = _nonce_key(payload.author, payload.nonce)

    # Trying to atomically capture nonce
    acquired = await redis_client.set(key, PENDING, nx=True, ex=NONCE_TTL_SECONDS)

    if not acquired:
        val = await redis_client.get(key)

        if val and val != PENDING:
            # Message already created (msg_id in Redis)
            try:
                msg_id = int(val)
                existing = await db.get(Message, msg_id)

                if existing:
                    if payload.enforce_nonce:
                        # Strict mode: Duplicate = Error 409
                        raise HTTPException(status_code=409, detail="nonce conflict")
                    else:
                        return existing
            except ValueError:
                pass

        if payload.enforce_nonce:
            raise HTTPException(status_code=409, detail="nonce conflict")

        # Soft mode: couldn't find it, we'll create a new one (the risk of a duplicate is minimal)

    # Create a new message
    try:
        msg = Message(
            room_id=room_id,
            author=payload.author,
            body=payload.body,
            nonce=payload.nonce,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
    except Exception:
        await redis_client.delete(key)
        raise

    # Publish msg_id to Redis (for future duplicates)
    # XX checks that the key exists (protects against TTL expiration)
    ok = await redis_client.set(key, str(msg.id), xx=True, ex=NONCE_TTL_SECONDS)
    if not ok:
        # TTL expired - delete key for cleanup
        await redis_client.delete(key)

    return msg