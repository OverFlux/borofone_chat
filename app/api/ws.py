from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.infra.db import SessionLocal
from app.models import Message

router = APIRouter()


class ConnectionManager:
    def __init__(self) -> None:
        self._rooms: dict[int, set[WebSocket]] = {}

    async def connect(self, ws: WebSocket, room_id: int) -> None:
        await ws.accept()  # accept обязателен до send/receive [web:1]
        self._rooms.setdefault(room_id, set()).add(ws)

    def disconnect(self, ws: WebSocket, room_id: int) -> None:
        room = self._rooms.get(room_id)
        if not room:
            return
        room.discard(ws)
        if not room:
            self._rooms.pop(room_id, None)

    async def broadcast(self, room_id: int, payload: dict) -> None:
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
    await manager.connect(ws, room_id)
    
    try:
        async with SessionLocal() as db:
            while True:
                data = await ws.receive_json()
                msg = Message(room_id = room_id, author = data["author"], body = data["body"])
                db.add(msg)
                await db.commit()
                await db.refresh(msg)

                await manager.broadcast(room_id, {
                    "type": "message.new",
                    "message": {
                        "id": msg.id,
                        "room_id": msg.room_id,
                        "author": msg.author,
                        "body": msg.body,
                        "created_at": msg.created_at.isoformat(),
                    }
                })
    except WebSocketDisconnect:
        manager.disconnect(ws, room_id)
