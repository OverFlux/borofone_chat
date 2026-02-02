"""
REST API endpoints for chat.

All endpoints use Pydantic schemes for validation.
"""
from fastapi import APIRouter, Depends, HTTPException

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import get_db
from app.infra.redis import ping_redis
from app.models import Message, Room
from app.schemas.common import HealthResponse
from app.schemas.rooms import RoomCreate, RoomResponse
from app.schemas.messages import MessageCreate, MessageResponse
from app.services.messages import create_message_with_nonce

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
    response_model=RoomResponse,
    status_code=201,
    summary="Create room",
    description="Creating a new room.",
)
async def create_room(
    payload: RoomCreate,
    db: AsyncSession = Depends(get_db)
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
    room = Room(title=payload.title)
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
    db: AsyncSession = Depends(get_db)
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
        select(Message)
        .where(Message.room_id == room_id)
        .order_by(Message.id.desc())
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    rows.reverse() # from old to new

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
                        "empty_author": {
                            "summary": "Author is empty",
                            "value": {"detail": [{"type": "value_error", "msg": "author cannot be empty"}]}
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
    db: AsyncSession = Depends(get_db)
):
    """
    Sending a message to a room.

    Request Body:
        MessageCreate: Validation message

    Validation:
        - author: 1-32 characters, not empty
        - body: 1-4096 characters, not empty
        - nonce: optional, 1-25 characters or NONE
        - enforce_nonce: Requires the presence of a nonce

    Returns:
        MessageResponse: Created or existing message

    Raises:
        HTTPException 409: Duplicated nonce at enforce_nonce=true
        HTTPException 400: Fields validation error
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
