"""Server-scoped WebSocket for chat, voice, and private user events."""
import asyncio
import json

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import SessionLocal
from app.infra.redis import room_events_channel, user_events_channel
from app.models import User, Room, ServerMember, VoiceRoom
from app.security import get_user_id_from_token
from app.services.voice import voice_runtime
from app.settings import settings

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
    server_id: int = Query(..., gt=0),
):
    """
    Один WebSocket на выбранный сервер.

    Через него клиент получает события текстовых комнат и передаёт presence,
    typing, voice и WebRTC signaling только внутри server_id.
    """
    origin = websocket.headers.get("origin")
    if settings.app_env.lower() == "production" and (
        not origin or origin.rstrip("/") not in settings.allowed_origins_list
    ):
        await websocket.close(code=1008, reason="Untrusted origin")
        return
    await websocket.accept()

    # ── Auth с отдельной сессией ───────────────────────────────────
    async with SessionLocal() as db:
        token_cookie = websocket.cookies.get("access_token")
        user = await get_user_from_websocket(websocket, db, token_cookie, token)

        if not user:
            await websocket.send_json({"type": "error", "code": "unauthorized"})
            await websocket.close()
            return

        membership = (
            await db.execute(
                select(ServerMember).where(
                    ServerMember.server_id == server_id,
                    ServerMember.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if not membership:
            await websocket.send_json({"type": "error", "code": "forbidden_server"})
            await websocket.close()
            return

        room_ids = set(
            (
                await db.execute(select(Room.id).where(Room.server_id == server_id))
            ).scalars().all()
        )
        voice_room_ids = set(
            (
                await db.execute(
                    select(VoiceRoom.id).where(
                        VoiceRoom.server_id == server_id,
                        VoiceRoom.is_active.is_(True),
                    )
                )
            ).scalars().all()
        )

    username = user.username
    user_id = user.id
    is_first_connection = await voice_runtime.register_connection(user_id, websocket, server_id)

    # ── Redis: подписываемся на ВСЕ комнаты ──────────────────────
    redis = None
    pubsub = None

    try:
        from app.infra.redis import get_redis_client
        redis = get_redis_client()
        if redis:
            # Use short timeout for ping to avoid blocking
            await asyncio.wait_for(redis.ping(), timeout=2.0)
    except asyncio.TimeoutError:
        print(f"[WS] Redis ping timeout")
        redis = None
    except Exception as e:
        print(f"[WS] Redis unavailable: {e}")
        redis = None

    if redis:
        try:
            pubsub = redis.pubsub()
            
            # Подписываемся на каждую комнату
            for room_id in room_ids:
                await pubsub.subscribe(room_events_channel(room_id))
            await pubsub.subscribe(user_events_channel(user_id))
            
            print(f"[WS] {username} subscribed to server {server_id}, rooms: {sorted(room_ids)[:5]}...")
        except Exception as e:
            print(f"[WS] Subscribe failed: {e}")
            pubsub = None
            redis = None

    print(f"[WS] {username} connected to server {server_id}")

    # Устанавливаем статус пользователя как онлайн
    if is_first_connection:
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

    async def broadcast_voice_presence(
        room_id: int,
        target_server_id: int | None = None,
        outside_only: bool = False,
    ) -> None:
        payload = {
            "type": "voice_room_presence",
            "room_id": room_id,
            "participants": await voice_runtime.participants_snapshot(room_id),
        }
        sockets = await voice_runtime.sockets_for_server(target_server_id or server_id)
        room_sockets = set(await voice_runtime.sockets_for_room(room_id)) if outside_only else set()
        for sock in sockets:
            if sock in room_sockets:
                continue
            try:
                await sock.send_json(payload)
            except Exception:
                pass

    async def broadcast_online_count(exclude: WebSocket | None = None) -> None:
        payload = {
            "type": "online_count",
            "total": await voice_runtime.online_users_count(server_id),
        }
        sockets = await voice_runtime.sockets_for_server(server_id)
        for sock in sockets:
            if exclude and sock is exclude:
                continue
            try:
                await sock.send_json(payload)
            except Exception:
                pass
    await broadcast_online_count()
    if is_first_connection:
        await broadcast_online_count(exclude=websocket)
    for voice_room_id in voice_room_ids:
        await websocket.send_json({
            "type": "voice_room_presence",
            "room_id": voice_room_id,
            "participants": await voice_runtime.participants_snapshot(voice_room_id),
        })

    # ── Task 1: receive from client ───────────────────────────────
    async def receive_messages() -> None:
        try:
            while not stop_event.is_set():
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                msg_type = data.get("type")

                if msg_type == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue

                room_id = data.get("room_id")
                if msg_type == "typing" and room_id not in room_ids:
                    await websocket.send_json({"type": "error", "code": "forbidden_room"})
                    continue

                if msg_type in {
                    "join_room",
                    "leave_room",
                    "set_mute",
                    "set_deafen",
                    "speaking",
                    "set_screen_share",
                    "rtc_offer",
                    "rtc_answer",
                    "rtc_ice",
                } and room_id not in voice_room_ids:
                    await websocket.send_json({"type": "error", "code": "forbidden_voice_room"})
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
                        server_id=server_id,
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
                        await broadcast_voice_presence(
                            prev_room_id,
                            prev_participant.server_id,
                        )
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
                        await broadcast_voice_presence(room_id, outside_only=True)
                    continue

                if msg_type == "set_deafen":
                    room_id = data.get("room_id")
                    deafened = bool(data.get("deafened"))
                    participant = await voice_runtime.update_state(room_id, user_id, deafened=deafened)
                    if participant:
                        await broadcast_voice(room_id, {"type": "participant_updated", "room_id": room_id, "participant": voice_runtime._as_dict(participant)})
                        await broadcast_voice_presence(room_id, outside_only=True)
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
                        await broadcast_voice_presence(room_id, outside_only=True)
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
                        await redis.publish(room_events_channel(room_id), json.dumps(payload))
                    else:
                        await websocket.send_json(payload)
                    continue

                if msg_type in {"rtc_offer", "rtc_answer", "rtc_ice"}:
                    room_id = data.get("room_id")
                    target_user_id = data.get("target_user_id")
                    if not room_id or not target_user_id:
                        continue
                    target_sockets = await voice_runtime.sockets_for_user_in_server(
                        int(target_user_id),
                        server_id,
                    )
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

        except WebSocketDisconnect:
            pass
        finally:
            room_id, participant, is_last_connection = await voice_runtime.unregister_connection_with_status(user_id, websocket)
            if room_id and participant:
                await broadcast_voice(room_id, {
                    "type": "participant_left",
                    "room_id": room_id,
                    "participant": {"user_id": participant.user_id, "username": participant.username, "display_name": participant.display_name},
                })
                await broadcast_voice_presence(room_id, participant.server_id)
            if is_last_connection:
                try:
                    async with SessionLocal() as db:
                        from app.services.presence import set_user_offline
                        await set_user_offline(db, user_id)
                except Exception as e:
                    print(f"[WS] Error setting user offline: {e}")
                await broadcast_online_count()
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
                        pass
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
