"""
Global WebSocket: подписывается на ВСЕ комнаты одновременно.

Простое решение без изменения БД:
- Клиент подключается к /ws
- Backend подписывается на room:* (все комнаты)
- Клиент получает события из всех комнат → показывает badge/звук
"""
import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.infra.db import SessionLocal
from app.models import User, Room, Message, MessageReaction
from app.schemas.messages import MessageCreate
from app.security import get_user_id_from_token
from app.services.messages import create_message_with_nonce
from app.services.voice import voice_runtime

router = APIRouter(tags=["WebSocket"])


async def get_user_from_websocket(
    websocket: WebSocket,
    db: AsyncSession,
    token_cookie: str | None = None,
    token_query: str | None = None,
) -> User | None:
    token = token_cookie or token_query
    if not token:
        return None

    user_id = get_user_id_from_token(token)
    if not user_id:
        return None

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        return None

    return user


@router.websocket("/ws")
async def global_websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(None),
):
    """
    Глобальный WebSocket — получает события из ВСЕХ комнат.
    
    Клиент:
    - Отправляет: {"type": "message", "room_id": 1, "body": "hi", "nonce": "x"}
    - Получает: {"type": "message", "room_id": 1, "id": 42, ...}
    """
    await websocket.accept()

    # ── Auth с отдельной сессией ───────────────────────────────────
    async with SessionLocal() as db:
        token_cookie = websocket.cookies.get("access_token")
        user = await get_user_from_websocket(websocket, db, token_cookie, token)

        if not user:
            await websocket.send_json({"type": "error", "code": "unauthorized"})
            await websocket.close()
            return

    username = user.username
    user_id = user.id
    await voice_runtime.register_connection(user_id, websocket)

    # ── Redis: подписываемся на ВСЕ комнаты ──────────────────────
    redis = None
    pubsub = None

    try:
        from app.infra.redis import get_redis_client
        redis = get_redis_client()
        if redis:
            await redis.ping()
    except Exception as e:
        print(f"[WS] Redis unavailable: {e}")
        redis = None

    if redis:
        try:
            # Загружаем все комнаты с отдельной сессией
            async with SessionLocal() as db:
                result = await db.execute(select(Room))
                rooms = result.scalars().all()
                room_ids = [room.id for room in rooms]

            pubsub = redis.pubsub()
            
            # Подписываемся на каждую комнату
            for room_id in room_ids:
                await pubsub.subscribe(f"room:{room_id}")
            
            print(f"[WS] {username} subscribed to {len(room_ids)} rooms")
        except Exception as e:
            print(f"[WS] Subscribe failed: {e}")
            pubsub = None
            redis = None

    print(f"[WS] {username} connected globally")

    # Устанавливаем статус пользователя как онлайн
    try:
        async with SessionLocal() as db:
            from app.services.presence import set_user_online
            await set_user_online(db, user_id)
    except Exception as e:
        print(f"[WS] Error setting user online: {e}")

    stop_event = asyncio.Event()

    await websocket.send_json({"type": "connected", "user": {"id": user_id}})

    async def broadcast_voice(room_id: int, payload: dict) -> None:
        sockets = await voice_runtime.sockets_for_room(room_id)
        for sock in sockets:
            try:
                await sock.send_json(payload)
            except Exception:
                pass

    async def broadcast_voice_presence(room_id: int) -> None:
        payload = {
            "type": "voice_room_presence",
            "room_id": room_id,
            "participants": await voice_runtime.participants_snapshot(room_id),
        }
        sockets = await voice_runtime.sockets_all()
        for sock in sockets:
            try:
                await sock.send_json(payload)
            except Exception:
                pass

    # ── Task 1: receive from client ───────────────────────────────
    async def receive_messages() -> None:
        try:
            while not stop_event.is_set():
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                msg_type = data.get("type")
                
                # Heartbeat — обновление присутствия
                if msg_type == "heartbeat":
                    room_id = data.get("room_id")
                    if room_id:
                        from app.services.presence import user_joined_room
                        await user_joined_room(redis, room_id, user_id)
                    continue
                
                if msg_type == "reaction":
                    room_id = data.get("room_id")
                    message_id = data.get("message_id")
                    emoji = (data.get("emoji") or "").strip()
                    if not room_id or not message_id or not emoji or len(emoji) > 16:
                        continue

                    try:
                        async with SessionLocal() as db:
                            message_stmt = select(Message).where(Message.id == message_id, Message.room_id == room_id)
                            message = (await db.execute(message_stmt)).scalar_one_or_none()
                            if not message or message.deleted_at is not None:
                                continue

                            existing_stmt = select(MessageReaction).where(
                                MessageReaction.message_id == message_id,
                                MessageReaction.user_id == user_id,
                                MessageReaction.emoji == emoji,
                            )
                            existing = (await db.execute(existing_stmt)).scalar_one_or_none()
                            action = "added"
                            if existing:
                                await db.delete(existing)
                                action = "removed"
                            else:
                                db.add(MessageReaction(message_id=message_id, user_id=user_id, emoji=emoji))

                            try:
                                await db.commit()
                            except IntegrityError:
                                await db.rollback()
                                final_stmt = select(MessageReaction).where(
                                    MessageReaction.message_id == message_id,
                                    MessageReaction.user_id == user_id,
                                    MessageReaction.emoji == emoji,
                                )
                                final_reaction = (await db.execute(final_stmt)).scalar_one_or_none()
                                action = "added" if final_reaction else "removed"

                            reactions_stmt = select(MessageReaction).where(MessageReaction.message_id == message_id)
                            reactions = (await db.execute(reactions_stmt)).scalars().all()

                        grouped = {}
                        for reaction in reactions:
                            grouped.setdefault(reaction.emoji, set()).add(reaction.user_id)

                        payload = {
                            "type": "reaction",
                            "room_id": room_id,
                            "message_id": message_id,
                            "emoji": emoji,
                            "action": action,
                            "actor_user_id": user_id,
                            "reactions": [
                                {
                                    "emoji": value,
                                    "count": len(user_ids),
                                    "reacted_by_me": False,
                                }
                                for value, user_ids in sorted(grouped.items(), key=lambda item: item[0])
                            ],
                        }

                        if redis:
                            await redis.publish(f"room:{room_id}", json.dumps(payload))
                        else:
                            await websocket.send_json(payload)
                    except Exception as e:
                        print(f"[WS] Reaction error: {e}")
                    continue

                if msg_type == "message_delete":
                    room_id = data.get("room_id")
                    message_id = data.get("message_id")
                    if not room_id or not message_id:
                        continue

                    try:
                        async with SessionLocal() as db:
                            msg_stmt = select(Message).where(Message.id == message_id, Message.room_id == room_id)
                            msg = (await db.execute(msg_stmt)).scalar_one_or_none()
                            if not msg or msg.user_id != user_id:
                                continue

                            msg.body = "Сообщение удалено"
                            msg.deleted_at = datetime.now(timezone.utc)
                            await db.commit()

                        payload = {
                            "type": "message_deleted",
                            "room_id": room_id,
                            "message_id": message_id,
                            "body": "Сообщение удалено",
                            "deleted_at": msg.deleted_at.isoformat() if msg.deleted_at else None,
                        }
                        if redis:
                            await redis.publish(f"room:{room_id}", json.dumps(payload))
                        else:
                            await websocket.send_json(payload)
                    except Exception as e:
                        print(f"[WS] Delete error: {e}")
                    continue

                if msg_type == "join_room":
                    room_id = data.get("room_id")
                    if not room_id:
                        continue
                    snapshot, participant, prev_room_id, prev_participant = await voice_runtime.join_room(
                        room_id=room_id,
                        user_id=user_id,
                        username=user.username,
                        display_name=user.display_name,
                        avatar_url=user.avatar_url,
                    )
                    if prev_room_id and prev_participant:
                        await broadcast_voice(prev_room_id, {
                            "type": "participant_left",
                            "room_id": prev_room_id,
                            "participant": {
                                "user_id": prev_participant.user_id,
                                "username": prev_participant.username,
                                "display_name": prev_participant.display_name,
                                "avatar_url": prev_participant.avatar_url,
                            },
                        })
                        await broadcast_voice_presence(prev_room_id)
                    await websocket.send_json({"type": "room_joined", "room_id": room_id, "participants": snapshot})
                    await broadcast_voice(room_id, {"type": "participant_joined", "room_id": room_id, "participant": voice_runtime._as_dict(participant)})
                    await broadcast_voice_presence(room_id)
                    continue

                if msg_type == "leave_room":
                    room_id = data.get("room_id")
                    if not room_id:
                        continue
                    participant = await voice_runtime.leave_room(room_id, user_id)
                    if participant:
                        await broadcast_voice(room_id, {
                            "type": "participant_left",
                            "room_id": room_id,
                            "participant": {"user_id": participant.user_id, "username": participant.username, "display_name": participant.display_name},
                        })
                        await broadcast_voice_presence(room_id)
                    continue

                if msg_type == "set_mute":
                    room_id = data.get("room_id")
                    muted = bool(data.get("muted"))
                    participant = await voice_runtime.update_state(room_id, user_id, muted=muted, speaking=False if muted else None)
                    if participant:
                        await broadcast_voice(room_id, {"type": "participant_updated", "room_id": room_id, "participant": voice_runtime._as_dict(participant)})
                    continue

                if msg_type == "set_deafen":
                    room_id = data.get("room_id")
                    deafened = bool(data.get("deafened"))
                    participant = await voice_runtime.update_state(room_id, user_id, deafened=deafened)
                    if participant:
                        await broadcast_voice(room_id, {"type": "participant_updated", "room_id": room_id, "participant": voice_runtime._as_dict(participant)})
                    continue

                if msg_type == "speaking":
                    room_id = data.get("room_id")
                    speaking = bool(data.get("speaking"))
                    participant = await voice_runtime.update_state(room_id, user_id, speaking=speaking)
                    if participant:
                        await broadcast_voice(room_id, {"type": "speaking", "room_id": room_id, "user_id": user_id, "speaking": speaking})
                    continue

                # Screen sharing
                if msg_type == "set_screen_share":
                    room_id = data.get("room_id")
                    sharing = bool(data.get("sharing"))
                    participant = await voice_runtime.update_state(room_id, user_id, screen_sharing=sharing)
                    if participant:
                        await broadcast_voice(room_id, {
                            "type": "screen_share_updated",
                            "room_id": room_id,
                            "user_id": user_id,
                            "screen_sharing": sharing,
                            "participant": voice_runtime._as_dict(participant),
                        })
                    continue

                # Typing indicator
                if msg_type == "typing":
                    room_id = data.get("room_id")
                    if not room_id:
                        continue
                    
                    # Get username for display
                    typing_username = username
                    
                    payload = {
                        "type": "typing",
                        "room_id": room_id,
                        "user_id": user_id,
                        "username": typing_username,
                    }
                    
                    # Broadcast to all subscribers of this room (except sender)
                    if redis:
                        await redis.publish(f"room:{room_id}", json.dumps(payload))
                    else:
                        await websocket.send_json(payload)
                    continue

                if msg_type in {"rtc_offer", "rtc_answer", "rtc_ice"}:
                    room_id = data.get("room_id")
                    target_user_id = data.get("target_user_id")
                    if not room_id or not target_user_id:
                        continue
                    target_sockets = await voice_runtime.sockets_for_user(int(target_user_id))
                    relay = {
                        "type": msg_type,
                        "room_id": room_id,
                        "from_user_id": user_id,
                        "target_user_id": int(target_user_id),
                        "payload": data.get("payload"),
                    }
                    for sock in target_sockets:
                        try:
                            await sock.send_json(relay)
                        except Exception:
                            pass
                    continue

                if msg_type != "message":
                    continue

                room_id = data.get("room_id")
                if not room_id:
                    continue

                try:
                    # Создаём новую сессию для каждого сообщения
                    async with SessionLocal() as db:
                        payload = MessageCreate(
                            body=data.get("body", ""), 
                            nonce=data.get("nonce"),
                            attachments=data.get("attachments"),
                            reply_to_id=data.get("reply_to_id")
                        )
                        msg = await create_message_with_nonce(
                            db, room_id, user_id, payload, redis,
                            attachments_data=payload.attachments
                        )
                        msg = (
                            await db.execute(
                                select(Message)
                                .where(Message.id == msg.id)
                                .options(joinedload(Message.user), selectinload(Message.attachments), joinedload(Message.reply_to).joinedload(Message.user))
                            )
                        ).scalar_one()

                        reply_to = None
                        if msg.reply_to:
                            reply_to = {
                                "id": msg.reply_to.id,
                                "body": msg.reply_to.body,
                                "user": {
                                    "id": msg.reply_to.user.id if msg.reply_to.user else 0,
                                    "username": msg.reply_to.user.username if msg.reply_to.user else "Unknown",
                                    "display_name": msg.reply_to.user.display_name if msg.reply_to.user else "Unknown User",
                                    "avatar_url": msg.reply_to.user.avatar_url if msg.reply_to.user else None,
                                },
                            }

                        message_data = {
                            "type": "message",
                            "id": msg.id,
                            "room_id": msg.room_id,
                            "nonce": msg.nonce,
                            "body": msg.body,
                            "created_at": msg.created_at.isoformat(),
                            "edited_at": msg.edited_at.isoformat() if msg.edited_at else None,
                            "user": {
                                "id": user_id,
                                "username": username,
                                "display_name": user.display_name,
                                "avatar_url": user.avatar_url,
                            },
                            "attachments": [
                                {
                                    "id": att.id,
                                    "message_id": att.message_id,
                                    "filename": att.filename,
                                    "file_path": att.file_path,
                                    "file_size": att.file_size,
                                    "mime_type": att.mime_type,
                                    "created_at": att.created_at.isoformat(),
                                }
                                for att in (msg.attachments or [])
                            ],
                            "reactions": [],
                            "reply_to": reply_to,
                            "is_deleted": msg.deleted_at is not None,
                        }

                    if redis:
                        try:
                            await redis.publish(f"room:{room_id}", json.dumps(message_data))
                        except Exception as e:
                            print(f"[WS] Publish failed: {e}")
                    else:
                        await websocket.send_json(message_data)

                except Exception as e:
                    print(f"[WS] Message error: {e}")

        except WebSocketDisconnect:
            pass
        finally:
            room_id, participant = await voice_runtime.unregister_connection(user_id, websocket)
            if room_id and participant:
                await broadcast_voice(room_id, {
                    "type": "participant_left",
                    "room_id": room_id,
                    "participant": {"user_id": participant.user_id, "username": participant.username, "display_name": participant.display_name},
                })
            stop_event.set()

    # ── Task 2: send to client ────────────────────────────────────
    async def send_messages() -> None:
        if not pubsub:
            await stop_event.wait()
            return

        try:
            while not stop_event.is_set():
                try:
                    message = await asyncio.wait_for(
                        pubsub.get_message(ignore_subscribe_messages=True), timeout=0.1
                    )
                except asyncio.TimeoutError:
                    continue

                if message and message["type"] == "message":
                    try:
                        await websocket.send_text(message["data"])
                    except Exception:
                        break
        except Exception as e:
            if "websocket.send" not in str(e):
                print(f"[WS] send error: {e}")
        finally:
            stop_event.set()

    await asyncio.gather(receive_messages(), send_messages(), return_exceptions=True)

    # ── Cleanup ───────────────────────────────────────────────────
    if pubsub:
        try:
            await pubsub.unsubscribe()
            await pubsub.aclose()
        except Exception as e:
            print(f"[WS] Cleanup error: {e}")

    # Устанавливаем статус пользователя как оффлайн
    try:
        async with SessionLocal() as db:
            from app.services.presence import set_user_offline
            await set_user_offline(db, user_id)
    except Exception as e:
        print(f"[WS] Error setting user offline: {e}")

    print(f"[WS] {username} disconnected")


# Старый endpoint оставляем для совместимости
@router.websocket("/ws/rooms/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: int, token: str = Query(None)):
    """Legacy endpoint. Use /ws instead."""
    await websocket.close(reason="Use /ws")
