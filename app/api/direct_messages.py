"""Private one-to-one conversations for Borotalk."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from redis.asyncio import Redis
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user
from app.infra.db import get_db
from app.infra.redis import get_redis, user_events_channel
from app.models import DirectConversation, DirectMessage, User
from app.schemas.direct_messages import (
    DirectConversationResponse,
    DirectMessageCreate,
    DirectMessageResponse,
)
from app.services.message_rate_limit import enforce_message_rate_limit


router = APIRouter(prefix="/direct-conversations", tags=["Direct messages"])


async def _require_conversation(
    db: AsyncSession,
    conversation_id: int,
    user_id: int,
) -> DirectConversation:
    conversation = await db.get(DirectConversation, conversation_id)
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    if user_id not in {conversation.user_low_id, conversation.user_high_id}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Conversation access denied")
    return conversation


def _message_response(message: DirectMessage) -> DirectMessageResponse:
    return DirectMessageResponse(
        id=message.id,
        conversation_id=message.conversation_id,
        sender_id=message.sender_id,
        body=message.body,
        nonce=message.nonce,
        created_at=message.created_at.isoformat(),
        deleted_at=message.deleted_at.isoformat() if message.deleted_at else None,
    )


def _conversation_response(
    conversation: DirectConversation,
    peer: User,
) -> DirectConversationResponse:
    return DirectConversationResponse(
        id=conversation.id,
        peer_id=peer.id,
        peer_username=peer.username,
        peer_display_name=peer.display_name,
        peer_avatar_url=peer.avatar_url,
        created_at=conversation.created_at.isoformat(),
    )


@router.get("", response_model=list[DirectConversationResponse])
async def list_direct_conversations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(DirectConversation)
        .where(
            or_(
                DirectConversation.user_low_id == current_user.id,
                DirectConversation.user_high_id == current_user.id,
            )
        )
        .order_by(DirectConversation.created_at.desc())
    )
    conversations = result.scalars().all()
    peer_ids = {
        conversation.user_high_id
        if conversation.user_low_id == current_user.id
        else conversation.user_low_id
        for conversation in conversations
    }
    peers = {}
    if peer_ids:
        peer_result = await db.execute(select(User).where(User.id.in_(peer_ids), User.is_active.is_(True)))
        peers = {peer.id: peer for peer in peer_result.scalars().all()}

    responses = []
    for conversation in conversations:
        peer_id = (
            conversation.user_high_id
            if conversation.user_low_id == current_user.id
            else conversation.user_low_id
        )
        peer = peers.get(peer_id)
        if peer:
            responses.append(_conversation_response(conversation, peer))
    return responses


@router.post(
    "/with/{peer_id}",
    response_model=DirectConversationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_or_get_direct_conversation(
    peer_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if peer_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot message yourself")
    peer = await db.get(User, peer_id)
    if not peer or not peer.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    user_low_id, user_high_id = sorted((current_user.id, peer_id))
    result = await db.execute(
        select(DirectConversation).where(
            DirectConversation.user_low_id == user_low_id,
            DirectConversation.user_high_id == user_high_id,
        )
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        conversation = DirectConversation(user_low_id=user_low_id, user_high_id=user_high_id)
        db.add(conversation)
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            conversation = (
                await db.execute(
                    select(DirectConversation).where(
                        DirectConversation.user_low_id == user_low_id,
                        DirectConversation.user_high_id == user_high_id,
                    )
                )
            ).scalar_one()
        else:
            await db.refresh(conversation)

    return _conversation_response(conversation, peer)


@router.get("/{conversation_id}/messages", response_model=list[DirectMessageResponse])
async def list_direct_messages(
    conversation_id: int,
    limit: int = Query(50, ge=1, le=100),
    before_id: int | None = Query(None, gt=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_conversation(db, conversation_id, current_user.id)
    stmt = select(DirectMessage).where(DirectMessage.conversation_id == conversation_id)
    if before_id is not None:
        stmt = stmt.where(DirectMessage.id < before_id)
    result = await db.execute(stmt.order_by(DirectMessage.id.desc()).limit(limit))
    return [_message_response(message) for message in reversed(result.scalars().all())]


@router.post(
    "/{conversation_id}/messages",
    response_model=DirectMessageResponse,
    status_code=status.HTTP_201_CREATED,
)
async def post_direct_message(
    conversation_id: int,
    payload: DirectMessageCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    redis: Redis | None = Depends(get_redis),
):
    conversation = await _require_conversation(db, conversation_id, current_user.id)
    if payload.nonce:
        existing = (
            await db.execute(
                select(DirectMessage).where(
                    DirectMessage.conversation_id == conversation_id,
                    DirectMessage.sender_id == current_user.id,
                    DirectMessage.nonce == payload.nonce,
                )
            )
        ).scalar_one_or_none()
        if existing:
            return _message_response(existing)

    await enforce_message_rate_limit(redis, current_user.id)
    message = DirectMessage(
        conversation_id=conversation_id,
        sender_id=current_user.id,
        body=payload.body,
        nonce=payload.nonce,
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    response = _message_response(message)

    if redis:
        event = {"type": "direct_message", **response.model_dump()}
        peer_id = (
            conversation.user_high_id
            if conversation.user_low_id == current_user.id
            else conversation.user_low_id
        )
        for recipient_id in {current_user.id, peer_id}:
            try:
                await redis.publish(user_events_channel(recipient_id), json.dumps(event))
            except Exception:
                pass

    return response
