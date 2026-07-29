"""REST endpoints for plain text-channel messages."""
import json

from fastapi import APIRouter, Depends, Query, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.dependencies import get_current_user
from app.infra.db import get_db
from app.infra.redis import get_redis, room_events_channel
from app.models import Message, User
from app.schemas.messages import MessageCreate, MessageResponse, MessageUserResponse
from app.services.access import require_room_member
from app.services.message_rate_limit import enforce_message_rate_limit
from app.services.messages import create_message_with_nonce

router = APIRouter()


def serialize_message(message: Message) -> MessageResponse:
    user = message.user
    return MessageResponse(
        id=message.id,
        room_id=message.room_id,
        nonce=message.nonce,
        body=message.body,
        created_at=message.created_at.isoformat(),
        user=MessageUserResponse(
            id=user.id if user else 0,
            username=user.username if user else "unknown",
            display_name=user.display_name if user else "Unknown User",
            avatar_url=user.avatar_url if user else None,
            role=user.role if user else "member",
        ),
    )


@router.get("/rooms/{room_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    room_id: int,
    limit: int = Query(50, ge=1, le=100),
    before_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await require_room_member(db, room_id, current_user)
    statement = select(Message).where(Message.room_id == room_id)
    if before_id is not None:
        statement = statement.where(Message.id < before_id)
    statement = (
        statement
        .options(joinedload(Message.user))
        .order_by(Message.id.desc())
        .limit(limit)
    )
    result = await db.execute(statement)
    messages = list(reversed(result.scalars().all()))
    return [serialize_message(message) for message in messages]


@router.post(
    "/rooms/{room_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_message(
    room_id: int,
    payload: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    room = await require_room_member(db, room_id, current_user)
    await enforce_message_rate_limit(redis, current_user.id)
    message = await create_message_with_nonce(
        db=db,
        room_id=room_id,
        user_id=current_user.id,
        payload=payload,
        redis=redis,
    )
    message = (
        await db.execute(
            select(Message)
            .where(Message.id == message.id)
            .options(joinedload(Message.user))
        )
    ).scalar_one()
    response = serialize_message(message)
    event = {"type": "message", **response.model_dump()}

    delivered = False
    if redis:
        try:
            delivered = bool(
                await redis.publish(
                    room_events_channel(room_id),
                    json.dumps(event),
                )
            )
        except Exception:
            pass

    if not delivered:
        from app.services.voice import voice_runtime

        for socket in await voice_runtime.sockets_for_server(room.server_id):
            try:
                await socket.send_json(event)
            except Exception:
                pass

    return response
