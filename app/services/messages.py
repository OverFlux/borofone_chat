from __future__ import annotations

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.redis import redis_client
from app.models import Message
from app.schemas.messages import MessageCreate

NONCE_TTL_SECONDS = 300  # "past few minutes" (берём 5 минут)
PENDING = "PENDING"


def _nonce_key(author: str, nonce: str) -> str:
    # Discord формулирует дедуп как "same author + same nonce"
    return f"nonce:{author}:{nonce}"


async def create_message_with_nonce(
    db: AsyncSession,
    room_id: int,
    payload: MessageCreate,
) -> Message:
    # 1) Если enforce_nonce выключен или nonce не задан — просто создаём запись
    if (not payload.enforce_nonce) or (payload.nonce is None):
        msg = Message(
            room_id=room_id,
            author=payload.author,
            body=payload.body,
            nonce=payload.nonce,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)
        return msg

    # 2) enforce_nonce=true: делаем "дедуп-окно" через Redis TTL
    key = _nonce_key(payload.author, payload.nonce)

    # Атомарно: "я первый, кто обрабатывает этот nonce" (NX) + окно (EX)
    acquired = await redis_client.set(key, PENDING, nx=True, ex=NONCE_TTL_SECONDS)
    if not acquired:
        # Кто-то уже создавал/создаёт: либо там msg_id, либо PENDING
        val = await redis_client.get(key)
        if val and val != PENDING:
            try:
                msg_id = int(val)
            except ValueError:
                raise HTTPException(status_code=409, detail="nonce conflict")

            existing = await db.get(Message, msg_id)
            if existing is not None:
                return existing

        # PENDING или битое значение -> считаем конфликтом/гонкой
        raise HTTPException(status_code=409, detail="nonce conflict")

    # 3) Мы "владельцы" nonce в этом окне: создаём сообщение в БД
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
        # Если БД упала — освобождаем nonce, чтобы клиент мог ретраить
        await redis_client.delete(key)
        raise

    # 4) Публикуем msg_id в Redis (чтобы дубликаты возвращали уже созданное)
    # XX = "ключ должен существовать" (чтобы случайно не воскресить удалённый TTL)
    ok = await redis_client.set(key, str(msg.id), xx=True, ex=NONCE_TTL_SECONDS)
    if not ok:
        # Редкий кейс: TTL истёк прямо сейчас/ключ пропал — не ломаем запрос, но чистим
        await redis_client.delete(key)

    return msg
