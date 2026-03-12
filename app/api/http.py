"""REST API endpoints for chat."""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.dependencies import get_current_user, require_admin
from app.infra.db import get_db
from app.infra.redis import get_redis, room_events_channel
from app.models import Message, MessageReaction, Room, User
from app.schemas.messages import (
    AttachmentResponse,
    MessageCreate,
    MessageEdit,
    MessageReplyPreview,
    MessageResponse,
    MessageUserResponse,
    ReactionCreate,
    ReactionResponse,
)
from app.schemas.rooms import RoomCreate, RoomResponse
from app.services.messages import create_message_with_nonce

router = APIRouter()


def build_reactions_payload(reactions: list[MessageReaction], current_user_id: int) -> list[ReactionResponse]:
    grouped: dict[str, set[int]] = {}
    for reaction in reactions or []:
        grouped.setdefault(reaction.emoji, set()).add(reaction.user_id)
    return [
        ReactionResponse(emoji=emoji, count=len(user_ids), reacted_by_me=current_user_id in user_ids)
        for emoji, user_ids in sorted(grouped.items(), key=lambda item: item[0])
    ]


def build_reply_preview(msg: Message) -> MessageReplyPreview | None:
    if not msg.reply_to:
        return None
    reply_user = msg.reply_to.user
    preview_body = "Сообщение было удалено" if msg.reply_to.deleted_at is not None else msg.reply_to.body
    return MessageReplyPreview(
        id=msg.reply_to.id,
        body=preview_body,
        user=MessageUserResponse(
            id=reply_user.id if reply_user else 0,
            username=reply_user.username if reply_user else "Unknown",
            display_name=reply_user.display_name if reply_user else "Unknown User",
            avatar_url=reply_user.avatar_url if reply_user else None,
        ),
    )


def serialize_message(msg: Message, current_user: User) -> MessageResponse:
    return MessageResponse(
        id=msg.id,
        room_id=msg.room_id,
        nonce=msg.nonce,
        body=msg.body,
        created_at=msg.created_at.isoformat(),
        edited_at=msg.edited_at.isoformat() if msg.edited_at else None,
        user=MessageUserResponse(
            id=msg.user.id if msg.user else 0,
            username=msg.user.username if msg.user else "Unknown",
            display_name=msg.user.display_name if msg.user else "Unknown User",
            avatar_url=msg.user.avatar_url if msg.user else None,
            role=msg.user.role if msg.user else "member",
        ),
        attachments=[
            AttachmentResponse(
                id=att.id,
                message_id=att.message_id,
                filename=att.filename,
                file_path=att.file_path,
                file_size=att.file_size,
                mime_type=att.mime_type,
                created_at=att.created_at.isoformat(),
            )
            for att in (msg.attachments or [])
        ],
        reactions=build_reactions_payload(msg.reactions or [], current_user.id),
        reply_to=build_reply_preview(msg),
        is_deleted=msg.deleted_at is not None,
    )


@router.post("/rooms", dependencies=[Depends(require_admin)], response_model=RoomResponse, status_code=201)
async def create_room(
    payload: RoomCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = Room(title=payload.title, created_by=current_user.id)
    db.add(room)
    await db.commit()
    await db.refresh(room)
    return {"id": room.id, "title": room.title}


@router.get("/rooms/{room_id}/messages", response_model=list[MessageResponse])
async def list_messages(
    room_id: int,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        select(Message)
        .where(Message.room_id == room_id)
        .options(
            joinedload(Message.user),
            selectinload(Message.attachments),
            selectinload(Message.reactions),
            selectinload(Message.reply_to).joinedload(Message.user),
        )
        .order_by(Message.id.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    messages = list(reversed(result.scalars().all()))
    return [serialize_message(msg, current_user) for msg in messages]


@router.post("/rooms/{room_id}/messages/{message_id}/reactions", status_code=status.HTTP_200_OK)
async def toggle_reaction(
    room_id: int,
    message_id: int,
    payload: ReactionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    emoji = payload.emoji.strip()
    message_stmt = select(Message).where(Message.id == message_id, Message.room_id == room_id)
    message = (await db.execute(message_stmt)).scalar_one_or_none()
    if not message:
        raise HTTPException(status_code=404, detail="message not found")
    if message.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cannot react to deleted message")

    existing_stmt = select(MessageReaction).where(
        MessageReaction.message_id == message_id,
        MessageReaction.user_id == current_user.id,
        MessageReaction.emoji == emoji,
    )
    existing = (await db.execute(existing_stmt)).scalar_one_or_none()

    action = "added"
    if existing:
        await db.delete(existing)
        action = "removed"

    else:
        db.add(MessageReaction(message_id=message_id, user_id=current_user.id, emoji=emoji))

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        existing_after_race = (await db.execute(existing_stmt)).scalar_one_or_none()
        action = "added" if existing_after_race else "removed"

    refreshed = (
        await db.execute(select(Message).where(Message.id == message_id).options(selectinload(Message.reactions)))
    ).scalar_one()
    response_reactions = [r.model_dump() for r in build_reactions_payload(refreshed.reactions or [], current_user.id)]
    broadcast_reactions = [{**reaction, "reacted_by_me": False} for reaction in response_reactions]

    reaction_event = {
        "type": "reaction",
        "room_id": room_id,
        "message_id": message_id,
        "emoji": emoji,
        "action": action,
        "actor_user_id": current_user.id,
        "reactions": response_reactions,
    }
    if redis:
        try:
            await redis.publish(room_events_channel(room_id), json.dumps({**reaction_event, "reactions": broadcast_reactions}))
        except Exception:
            pass
    return reaction_event


@router.delete("/rooms/{room_id}/messages/{message_id}", status_code=status.HTTP_200_OK)
async def delete_message(
    room_id: int,
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    msg_stmt = select(Message).where(Message.id == message_id, Message.room_id == room_id)
    msg = (await db.execute(msg_stmt)).scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="message not found")
    if msg.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="can delete only own message")

    msg.body = "Сообщение удалено"
    msg.deleted_at = datetime.now(timezone.utc)
    await db.commit()

    event = {
        "type": "message_deleted",
        "room_id": room_id,
        "message_id": message_id,
        "body": msg.body,
        "deleted_at": msg.deleted_at.isoformat() if msg.deleted_at else None,
    }
    if redis:
        try:
            await redis.publish(room_events_channel(room_id), json.dumps(event))
        except Exception:
            pass
    return event


@router.patch("/rooms/{room_id}/messages/{message_id}", response_model=MessageResponse)
async def edit_message(
    room_id: int,
    message_id: int,
    payload: MessageEdit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    """Edit a message - only the author can edit their own message."""
    msg_stmt = select(Message).where(Message.id == message_id, Message.room_id == room_id)
    msg = (await db.execute(msg_stmt)).scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="message not found")
    if msg.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="can edit only own message")
    if msg.deleted_at is not None:
        raise HTTPException(status_code=400, detail="cannot edit deleted message")

    msg.body = payload.body
    msg.edited_at = datetime.now(timezone.utc)
    await db.commit()

    # Reload message with relationships for response
    refreshed = (
        await db.execute(
            select(Message)
            .where(Message.id == message_id)
            .options(
                joinedload(Message.user),
                selectinload(Message.attachments),
                selectinload(Message.reactions),
                selectinload(Message.reply_to).joinedload(Message.user),
            )
        )
    ).scalar_one()

    event = {
        "type": "message_edited",
        "room_id": room_id,
        "message_id": message_id,
        "body": msg.body,
        "edited_at": msg.edited_at.isoformat() if msg.edited_at else None,
    }
    print(f"[HTTP] Publishing message_edited event: room_id={room_id}, message_id={message_id}")
    if redis:
        try:
            await redis.publish(room_events_channel(room_id), json.dumps(event))
        except Exception as e:
            print(f"[HTTP] Failed to publish message_edited: {e}")

    return serialize_message(refreshed, current_user)


@router.delete("/rooms/{room_id}/messages/{message_id}/hard", status_code=status.HTTP_200_OK)
async def hard_delete_message(
    room_id: int,
    message_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    redis: Redis = Depends(get_redis),
):
    """
    Hard delete a message (permanent deletion).
    
    Only admins can perform hard delete on any message.
    This completely removes the message from the database.
    """
    msg_stmt = select(Message).where(Message.id == message_id, Message.room_id == room_id)
    msg = (await db.execute(msg_stmt)).scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="message not found")

    # Store event data before deletion
    event = {
        "type": "message_hard_deleted",
        "room_id": room_id,
        "message_id": message_id,
    }

    # Delete the message permanently
    await db.delete(msg)
    await db.commit()

    if redis:
        try:
            await redis.publish(room_events_channel(room_id), json.dumps(event))
        except Exception:
            pass
    
    return event


@router.post("/rooms/{room_id}/messages", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def post_message(
    room_id: int,
    payload: MessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
):
    msg = await create_message_with_nonce(
        db=db,
        room_id=room_id,
        user_id=current_user.id,
        payload=payload,
        redis=redis,
        attachments_data=payload.attachments,
    )
    refreshed = (
        await db.execute(
            select(Message)
            .where(Message.id == msg.id)
            .options(
                joinedload(Message.user),
                selectinload(Message.attachments),
                selectinload(Message.reactions),
                selectinload(Message.reply_to).joinedload(Message.user),
            )
        )
    ).scalar_one()
    return serialize_message(refreshed, current_user)
