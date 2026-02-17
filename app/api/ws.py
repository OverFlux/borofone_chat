"""
WebSocket endpoint с правильным connection management.

Исправления:
1. pubsub инициализируется вне if блока
2. Правильное закрытие Redis connections
3. Graceful handling когда Redis недоступен
"""
import asyncio
import json
import traceback
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import get_db
from app.models import User
from app.schemas.messages import MessageCreate
from app.security import get_user_id_from_token
from app.services.messages import create_message_with_nonce

router = APIRouter(tags=["WebSocket"])

async def get_user_from_websocket(
    websocket: WebSocket,
    db: AsyncSession,
    token_cookie: str | None = None,
    token_query: str | None = None
) -> User | None:
    """Получение пользователя из WebSocket соединения."""
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


@router.websocket("/ws/rooms/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: int,
    db: AsyncSession = Depends(get_db),
    token: str = Query(None),  # Fallback для старых клиентов
):
    """WebSocket endpoint для real-time чата."""

    await websocket.accept()

    # Аутентификация
    token_cookie = websocket.cookies.get("access_token")
    user = await get_user_from_websocket(
        websocket,
        db,
        token_cookie=token_cookie,
        token_query=token
    )

    if not user:
        await websocket.send_json({
            "type": "error",
            "code": "unauthorized",
            "detail": "Authentication required"
        })
        await websocket.close()
        return

    username = user.username

    # redis scope
    redis = None
    pubsub = None

    try:
        from app.infra.redis import redis_client
        redis = redis_client
        if redis:
            await redis.ping()
            print(f"[WebSocket] Redis connected for user {username}")
    except Exception as e:
        print(f"⚠️ Redis unavailable in WebSocket: {e}")
        redis = None

    # Subscribe to Redis channel (if redis connected)
    channel_name = f"room:{room_id}"

    if redis:
        try:
            pubsub = redis.pubsub()
            await pubsub.subscribe(channel_name)
            print(f"[WebSocket] Subscribed to {channel_name}")
        except Exception as e:
            print(f"⚠️ [WebSocket] Subscribe failed: {e}")
            pubsub = None
            redis = None # Отключение Redis если subscribe не работает

    print(f"[WebSocket] User {username} connected to room {room_id}")


    try:
        # Send welcome message
        await websocket.send_json({
            "type": "connected",
            "room_id": room_id,
            "user": {
                "id": user.id,
                "username": user.username,
                "display_name": user.display_name,
            },
        })

        # Handle messages
        async def receive_messages() -> None:
            """Receive messages from client."""
            try:
                while True:
                    data = await websocket.receive_json()

                    if data.get("type") == "message":
                        try:
                            payload = MessageCreate(
                                body=data.get("body", ""),
                                nonce=data.get("nonce")
                            )

                            msg = await create_message_with_nonce(
                                db=db,
                                room_id=room_id,
                                user_id=user.id,
                                payload=payload,
                                redis=redis
                            )

                            # Формируем сообщение для broadcast
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
                                    "avatar_url": user.avatar_url
                                }
                            }

                            # Publish to Redis (если доступен)
                            if redis:
                                try:
                                    # Redis publish принимает string
                                    await redis.publish(
                                        channel_name,
                                        json.dumps(message_data)
                                    )
                                except Exception as e:
                                    print(f"⚠️ Redis publish failed: {e}")
                                    # Fallback: отправляем напрямую
                                    await websocket.send_json(message_data)
                            else:
                                # Нет Redis - отправляем напрямую
                                await websocket.send_json(message_data)

                        except ValueError as e:
                            await websocket.send_json({
                                "type": "error",
                                "code": "validation_error",
                                "detail": str(e)
                            })
                        except Exception as e:
                            print(f"[WebSocket] Error creating message: {e}")
                            await websocket.send_json({
                                "type": "error",
                                "code": "internal_error",
                                "detail": "Failed to send message"
                            })
            except WebSocketDisconnect:
                pass

        async def send_messages():
            """Send messages from Redis to client."""
            if not pubsub:
                # Нет Redis - просто ждём и ничего не делаем
                try:
                    while True:
                        await asyncio.sleep(1)
                except WebSocketDisconnect:
                    pass
                return

            try:
                while True:
                    # Получаем сообщение из Redis
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True,
                        timeout=1.0
                    )
                    if message and message['type'] == 'message':
                        # Отправляем клиенту
                        await websocket.send_text(message['data'])
                    await asyncio.sleep(0.01)
            except WebSocketDisconnect:
                pass
            except Exception as e:
                print(f"[WebSocket] Error in send_messages: {e}")

        # Run both tasks concurrently
        await asyncio.gather(
            receive_messages(),
            send_messages()
        )

    except WebSocketDisconnect:
        print(f"[WebSocket] User {username} disconnected from room {room_id}")
    except Exception as e:
        print(f"[WebSocket] Unexpected error: {e}")
        traceback.print_exc()
    finally:
        if pubsub:
            try:
                await pubsub.unsubscribe(channel_name)
                await pubsub.close()
                print(f"[WebSocket] Unsubscribed from {channel_name}")
            except Exception as e:
                print(f"⚠️ Error closing pubsub: {e}")

        print(f"[WebSocket] Cleanup completed for user {username}")
