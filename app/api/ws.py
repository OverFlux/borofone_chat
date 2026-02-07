"""
WebSocket endpoints for real-time чата.

Used Pydantic MessageCreate for validation input messages.
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException, status
from pydantic import ValidationError

from app.infra.db import SessionLocal
from app.models import User
from app.security import get_user_id_from_token
from app.schemas.messages import MessageCreate
from app.services.messages import create_message_with_nonce

router = APIRouter()


class ConnectionManager:
    """
    Manager WebSocket connections.

    IMPORTANT: Only works within a single process.
    Redis Pub/Sub is required for horizontal scaling.
    """

    def __init__(self) -> None:
        # room_id -> set of WebSocket connections
        self._rooms: dict[int, set[WebSocket]] = {}

    async def connect(self, ws: WebSocket, room_id: int) -> None:
        await ws.accept()
        self._rooms.setdefault(room_id, set()).add(ws)

    def disconnect(self, ws: WebSocket, room_id: int) -> None:
        room = self._rooms.get(room_id)
        if not room:
            return
        room.discard(ws)
        if not room:
            self._rooms.pop(room_id, None)

    async def broadcast(self, room_id: int, payload: dict) -> None:
        """
        Broadcast messages to all clients in the room.

        Automatically removes dead connections.
        """
        room = self._rooms.get(room_id, set())
        dead: list[WebSocket] = []

        for ws in room:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws, room_id)


manager = ConnectionManager()


@router.websocket("/ws/rooms/{room_id}")
async def ws_room(ws: WebSocket, room_id: int):
    """
    WebSocket endpoint for real-time message trade.

    Read protocol from ws_protocol docs
    """
    token = ws.query_params.get("token")

    if not token:
        await ws.accept()
        await ws.send_json({
            "type": "error",
            "code": status.HTTP_401_UNAUTHORIZED,
            "detail": "Missing token",
        })
        await ws.close(code=1008)
        return

    try:
        async with SessionLocal() as db:
            user_id = get_user_id_from_token(token)
            if user_id is None:
                await ws.accept()
                await ws.send_json({
                    "type": "error",
                    "code": status.HTTP_401_UNAUTHORIZED,
                    "detail": "Invalid or expired token",
                })
                await ws.close(code=1008)
                return

            current_user = await db.get(User, user_id)
            if current_user is None or not current_user.is_active:
                await ws.accept()
                await ws.send_json({
                    "type": "error",
                    "code": status.HTTP_401_UNAUTHORIZED,
                    "detail": "User not found or disabled",
                })
                await ws.close(code=1008)
                return

            await manager.connect(ws, room_id)

            while True:
                data = await ws.receive_json()

                # Validation by Pydentic
                try:
                    payload = MessageCreate(**data)
                except ValidationError as e:
                    await ws.send_json({
                        # Pydantic validation failed
                        "type": "error",
                        "code": "validation_error",
                        "detail": e.errors()
                    })
                    continue

                # Creating message
                try:
                    msg = await create_message_with_nonce(
                        db=db,
                        room_id=room_id,
                        user_id=current_user.id,
                        payload=payload
                    )
                except HTTPException as e:
                    # Service error (For example: nonce conflict)
                    await ws.send_json({
                        "type": "error",
                        "code": e.status_code,
                        "detail": e.detail
                    })
                    continue
                except Exception as e:
                    # Unexpected error
                    import logging
                    logging.exception("Failed to create message via WebSocket")

                    await ws.send_json({
                        "type": "error",
                        "code": 500,
                        "detail": "internal server error"
                    })
                    continue

                # Broadcast
                # Send a new message to all clients in the room
                await manager.broadcast(
                    room_id,
                    {
                        "type": "message.new",
                        "message": {
                            "id": msg.id,
                            "room_id": msg.room_id,
                            "user_id": msg.user_id,
                            "author": current_user.username,
                            "nonce": msg.nonce,
                            "body": msg.body,
                            "created_at": msg.created_at.isoformat(),
                        },
                    },
                )

    except WebSocketDisconnect:
        manager.disconnect(ws, room_id)
