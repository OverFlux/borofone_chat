from fastapi import APIRouter, Depends

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import get_db
from app.infra.redis import ping_redis
from app.models import Message, Room
from app.schemas.messages import MessageCreate
from app.services.messages import create_message_with_nonce

router = APIRouter()


# Health check endpoint, ping Redis and PostgresSQL.
@router.get("/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(select(1))
    redis_ok = await ping_redis()
    return {"ok": True, "redis": redis_ok}


# Создание новой комнаты чата.
@router.post("/rooms")
async def create_room(payload: dict, db: AsyncSession = Depends(get_db)):
    room = Room(title=str(payload.get("title", "room"))) # TODO: Вместо payload словаря - сделать pydantic типизацию
    db.add(room) # {"id": 1, "title": "Room name"}
    await db.commit()
    await db.refresh(room)
    return {"id": room.id, "title": room.title}


# Получение истории сообщений комнаты.
@router.get("/rooms/{room_id}/messages")
async def list_messages(room_id: int, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """
    Query params:
        limit: максимум сообщений (по умолчанию 50)

    Returns:
        Список сообщений в хронологическом порядке (от старых к новым)
    """
    stmt = (
        select(Message)
        .where(Message.room_id == room_id)
        .order_by(Message.id.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    rows.reverse() # Ревёрсим, теперь старые сообщения идут первыми
    return [
        {
            "id": m.id,
            "room_id": m.room_id,
            "nonce": m.nonce,
            "author": m.author,
            "body": m.body,
            "created_at": m.created_at.isoformat(),
        }
        for m in rows
    ]

# Отправка сообщения в комнату через REST API.
@router.post("/rooms/{room_id}/messages")
async def post_message(room_id: int, payload: MessageCreate, db: AsyncSession = Depends(get_db)):
    """
    Body:
        {
            "author": "user123",
            "body": "Hello!",
            "nonce": "optional-123",     // опционально
            "enforce_nonce": false        // опционально
        }

    Логика:
    - Использует create_message_with_nonce для дедупликации
    - При enforce_nonce=true и дубликате вернёт HTTP 409

    Returns:
        Созданное сообщение в JSON формате
    """
    msg = await create_message_with_nonce(db=db, room_id=room_id, payload=payload)
    return {
        "id": msg.id,
        "room_id": msg.room_id,
        "nonce": msg.nonce,
        "author": msg.author,
        "body": msg.body,
        "created_at": msg.created_at.isoformat(),
    }
