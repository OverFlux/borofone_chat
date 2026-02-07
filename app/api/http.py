"""
REST API endpoints for chat.

All endpoints use Pydantic schemes for validation.
"""
from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import get_db
from app.infra.redis import ping_redis
from app.models import Message, Room, User
from app.schemas.common import HealthResponse
from app.schemas.rooms import RoomCreate, RoomResponse
from app.schemas.messages import MessageCreate, MessageResponse
from app.services.messages import create_message_with_nonce
from app.dependencies import get_current_user, require_admin

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health Check",
    description="Check service health (PostgresSQL and Redis)"
)
async def health(db: AsyncSession = Depends(get_db)):
    """
    Health-check endpoint for monitoring.

    - **PostgreSQL** - SELECT 1
    - **Redis** - PING

    Returns:
        HealthResponse: {"ok": true, "redis": true/false}
    """
    await db.execute(select(1))
    redis_ok = await ping_redis()
    return {"ok": True, "redis": redis_ok}


@router.post(
    "/rooms",
    dependencies=[Depends(require_admin)],
    response_model=RoomResponse,
    status_code=201,
    summary="Create room",
    description="Creating a new room.",
)
async def create_room(
    payload: RoomCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Creating a new room.

    **// Request Body:**
        RoomCreate: {"title": "room_name"}

    **// Validation:**
        - `title` can be empty
        - `title` max 100 characters
        - Spaces at the edges are automatically removed

    Returns:
        RoomResponse: Created room with id

    """
    room = Room(
        title=payload.title,
        created_by=current_user.id
    )
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return {"id": room.id, "title": room.title}


@router.get(
    "/rooms/{room_id}/messages",
    response_model=list[MessageResponse],
    summary="Get message history",
    description="Returns the last N messages of a room"
)
async def list_messages(
    room_id: int,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get room message history.

    Args:
        room_id: ID rooms (path parameter)
        limit: Number of message (query parameter, by default 50)

    Returns:
        list[MessageResponse]: List of message (from old to new)

    Note:
        - Messages are sorted by created_at
        - The nonce field may be null
        - created_at is ISO 8601 format
    """
    stmt = (
        select(Message, User.username)
        .join(User, Message.user_id == User.id, isouter=True)
        .where(Message.room_id == room_id)
        .order_by(Message.id.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).all()
    rows.reverse() # from old to new

    return [
        {
            "id": message.id,
            "room_id": message.room_id,
            "nonce": message.nonce,
            "user_id": message.user_id,
            "author": username or "Unknown",
            "body": message.body,
            "created_at": message.created_at.isoformat(),
        }
        for message,username in rows
    ]


@router.post(
    "/rooms/{room_id}/messages",
    response_model=MessageResponse,
    status_code=201,
    summary="Send message",
    description="Sending the message by REST API with deduplication",
    responses={
        201: {
            "description": "Message created successfully",
            "model": MessageResponse
        },
        409: {
            "description": "Nonce conflict (duplicate at enforce_nonce=true)",
            "content": {
                "application/json": {
                    "example": {"detail": "nonce conflict"}
                }
            }
        },
        400: {
            "description": "Validation error",
            "content": {
                "application/json": {
                    "examples": {
                        "empty_user_id": {
                            "summary": "user_id is empty",
                            "value": {"detail": [{"type": "value_error", "msg": "user_id cannot be empty"}]}
                        },
                        "long_body": {
                            "summary": "The message is too long",
                            "value": {"detail": [{"type": "value_error", "msg": "body must be 4096 characters or less"}]}
                        },
                        "enforce_without_nonce": {
                            "summary": "enforce_nonce without nonce",
                            "value": {"detail": [{"type": "value_error", "msg": "enforce_nonce requires nonce to be set"}]}
                        }
                    }
                }
            }
        }
    }
)
async def post_message(
    room_id: int,
    payload: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Sending a message to a room.

    Request Body:
        MessageCreate: Validation message

    Validation:
        - user_id: 1-32 characters, not empty
        - body: 1-4096 characters, not empty
        - nonce: optional, 1-25 characters or NONE
        - enforce_nonce: Requires the presence of a nonce

    Returns:
        MessageResponse: Created or existing message

    Raises:
        HTTPException 409: Duplicated nonce at enforce_nonce=true
        HTTPException 400: Fields validation error
    """
    msg = await create_message_with_nonce(
        db=db,
        room_id=room_id,
        user_id=current_user.id,
        payload=payload)
    return {
        "id": msg.id,
        "room_id": msg.room_id,
        "user_id": msg.user_id,
        "author": current_user.username,
        "nonce": msg.nonce,
        "body": msg.body,
        "created_at": msg.created_at.isoformat(),
    }
