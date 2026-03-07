"""
Global WebSocket: подписывается на ВСЕ комнаты одновременно.

Простое решение без изменения БД:
- Клиент подключается к /ws
- Backend подписывается на room:* (все комнаты)
- Клиент получает события из всех комнат → показывает badge/звук
"""
import asyncio
import json

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import get_db
from app.models import User, Room
from app.schemas.messages import MessageCreate
from app.security import get_user_id_from_token
from app.services.messages import create_message_with_nonce

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
    db: AsyncSession = Depends(get_db),
    token: str = Query(None),
):
    """
    Глобальный WebSocket — получает события из ВСЕХ комнат.

    Клиент:
    - Отправляет: {"type": "message", "room_id": 1, "body": "hi", "nonce": "x"}
    - Получает: {"type": "message", "room_id": 1, "id": 42, ...}
    """
    await websocket.accept()

    # ── Auth ──────────────────────────────────────────────────────
    token_cookie = websocket.cookies.get("access_token")
    user = await get_user_from_websocket(websocket, db, token_cookie, token)

    if not user:
        await websocket.send_json({"type": "error", "code": "unauthorized"})
        await websocket.close()
        return

    username = user.username

    # ── Redis: подписываемся на ВСЕ комнаты ──────────────────────
    redis = None
    pubsub = None

    try:
        from app.infra.redis import get_redis_client
        redis = get_redis_client()
        if redis:
            await redis.ping()
            print(f"[WS] Redis OK user={username}")
    except Exception as e:
        print(f"[WS] Redis unavailable: {e}")
        redis = None

    if redis:
        try:
            # Загружаем все комнаты
            result = await db.execute(select(Room))
            rooms = result.scalars().all()

            pubsub = redis.pubsub()

            # Подписываемся на каждую комнату
            for room in rooms:
                await pubsub.subscribe(f"room:{room.id}")

            print(f"[WS] {username} subscribed to {len(rooms)} rooms")
        except Exception as e:
            print(f"[WS] Subscribe failed: {e}")
            pubsub = None
            redis = None

    print(f"[WS] {username} connected globally")

    stop_event = asyncio.Event()

    await websocket.send_json({"type": "connected", "user": {"id": user.id}})

    # ── Task 1: receive from client ───────────────────────────────
    async def receive_messages() -> None:
        try:
            while not stop_event.is_set():
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                if data.get("type") != "message":
                    continue

                room_id = data.get("room_id")
                if not room_id:
                    continue

                try:
                    payload = MessageCreate(body=data.get("body", ""), nonce=data.get("nonce"))
                    msg = await create_message_with_nonce(db, room_id, user.id, payload, redis)

                    message_data = {
                        "type": "message",
                        "id": msg.id,
                        "room_id": msg.room_id,
                        "nonce": msg.nonce,
                        "body": msg.body,
                        "created_at": msg.created_at.isoformat(),
                        "edited_at": msg.edited_at.isoformat() if msg.edited_at else None,
                        "user": {
                            "id": user.id,
                            "username": user.username,
                            "display_name": user.display_name,
                            "avatar_url": user.avatar_url,
                        },
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

    print(f"[WS] {username} disconnected")


# Старый endpoint оставляем для совместимости
@router.websocket("/ws/rooms/{room_id}")
async def room_websocket(websocket: WebSocket, room_id: int, db: AsyncSession = Depends(get_db), token: str = Query(None)):
    """Legacy endpoint. Use /ws instead."""
    await websocket.close(reason="Use /ws")
