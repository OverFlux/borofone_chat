"""
Message service with nonce deduplication using Redis + attachments support.

Changes:
- Redis client через dependency вместо global import
- Fallback если Redis недоступен
- Proper error handling
- Attachments support
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from typing import TYPE_CHECKING
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload

from app.infra.redis import redis_client
from app.models import Message, Attachment
from app.schemas.messages import MessageCreate

if TYPE_CHECKING:
    from redis.asyncio import Redis

NONCE_TTL_SECONDS = 300
PENDING = "PENDING"


def _nonce_key(user_id: int, nonce: str) -> str:
    """Generate Redis key for nonce."""
    return f"nonce:{user_id}:{nonce}"


# Discord-like deduplication message by nonce, docs for more info.
async def create_message_with_nonce(
        db: AsyncSession,
        room_id: int,
        user_id: int,
        payload: MessageCreate,
        redis: Redis | None = None,
        attachments_data: list[dict] | None = None,  # ← НОВОЕ: поддержка вложений
) -> Message:
    """
    Создать сообщение с nonce deduplication + вложениями.
    
    Args:
        db: Database session
        room_id: ID комнаты
        user_id: ID пользователя
        payload: MessageCreate (body, nonce, enforce_nonce)
        redis: Redis client для deduplication
        attachments_data: Список вложений из /attachments/upload
            [{"filename": "...", "file_path": "...", "file_size": ..., "mime_type": "..."}]
    
    Returns:
        Message с загруженными attachments
    """

    # Helper для создания сообщения с вложениями
    async def _create_message_with_attachments() -> Message:
        if payload.reply_to_id is not None:
            reply_stmt = select(Message).where(
                Message.id == payload.reply_to_id,
                Message.room_id == room_id,
            )
            reply_message = (await db.execute(reply_stmt)).scalar_one_or_none()
            if not reply_message:
                raise HTTPException(status_code=400, detail="reply target not found")
            if reply_message.deleted_at is not None:
                raise HTTPException(status_code=400, detail="reply target was deleted")

        msg = Message(
            room_id=room_id,
            user_id=user_id,
            body=payload.body,
            nonce=payload.nonce,
            reply_to_id=payload.reply_to_id,
        )
        db.add(msg)
        await db.flush()  # Получаем msg.id
        
        # Создаём вложения если есть
        if attachments_data:
            for att_data in attachments_data:
                attachment = Attachment(
                    message_id=msg.id,
                    filename=att_data["filename"],
                    file_path=att_data["file_path"],
                    file_size=att_data["file_size"],
                    mime_type=att_data.get("mime_type"),
                )
                db.add(attachment)
        
        await db.commit()
        
        # Загружаем сообщение с вложениями
        stmt = (
            select(Message)
            .where(Message.id == msg.id)
            .options(selectinload(Message.attachments), selectinload(Message.reactions), joinedload(Message.reply_to).joinedload(Message.user))
        )
        result = await db.execute(stmt)
        return result.scalar_one()

    # No nonce - no deduplication
    if payload.nonce is None:
        return await _create_message_with_attachments()

    # With nonce — check deduplication
    key = _nonce_key(user_id, payload.nonce)

    # === CASE 1: Redis unavailable - fallback to DB-only deduplication ===
    if redis is None:
        # Проверка дубликата в БД
        stmt = select(Message).where(
            Message.user_id == user_id,
            Message.nonce == payload.nonce
        ).options(selectinload(Message.attachments), selectinload(Message.reactions), joinedload(Message.reply_to).joinedload(Message.user))
        
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            if payload.enforce_nonce:
                raise HTTPException(status_code=409, detail="nonce conflict")
            return existing

        # Создание нового сообщения с вложениями
        return await _create_message_with_attachments()

    # === CASE 2: Redis available - full deduplication ===
    try:
        # Trying to atomically capture nonce
        acquired = await redis_client.set(key, PENDING, nx=True, ex=NONCE_TTL_SECONDS)

        if not acquired:
            val = await redis_client.get(key)

            if val and val != PENDING:
                # Message already created (msg_id in Redis)
                try:
                    msg_id = int(val)
                    
                    # Загружаем существующее сообщение с attachments
                    stmt = (
                        select(Message)
                        .where(Message.id == msg_id)
                        .options(selectinload(Message.attachments), selectinload(Message.reactions), joinedload(Message.reply_to).joinedload(Message.user))
                    )
                    result = await db.execute(stmt)
                    existing = result.scalar_one_or_none()

                    if existing:
                        if payload.enforce_nonce:
                            # Strict mode: Duplicate = Error 409
                            raise HTTPException(status_code=409, detail="nonce conflict")
                        else:
                            return existing
                except (ValueError, TypeError):
                    pass

            if payload.enforce_nonce:
                raise HTTPException(status_code=409, detail="nonce conflict")

            # Soft mode: couldn't find it, we'll create a new one (the risk of a duplicate is minimal)

        # Create a new message with attachments
        try:
            msg = await _create_message_with_attachments()
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

    except Exception as e:
        # Если Redis упал - fallback на DB-only логику
        if "Redis" in str(type(e).__name__):
            print(f"⚠️ Redis unavailable, falling back to DB-only: {e}")
            # Recursive call без Redis
            return await create_message_with_nonce(
                db, room_id, user_id, payload, 
                redis=None, 
                attachments_data=attachments_data  # ← Передаём attachments
            )
        raise


# Compatibility alias (для старого кода)
create_message_with_attachments = create_message_with_nonce
