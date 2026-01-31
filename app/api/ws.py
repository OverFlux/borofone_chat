from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.infra.db import SessionLocal
from app.schemas.messages import MessageCreate
from app.services.messages import create_message_with_nonce

router = APIRouter()

# Менеджер WebSocket подключений для real-time коммуникации.
class ConnectionManager:
    """
    Управляет подключениями клиентов к комнатам и broadcast сообщений.

    Архитектура:
    - Каждая комната (room_id) имеет набор активных WebSocket соединений
    - При отправке сообщения делается broadcast всем клиентам в комнате
    - При разрыве соединения клиент автоматически удаляется из комнаты

    ВАЖНО: Текущая реализация работает только в пределах одного процесса.
    При горизонтальном масштабировании (2+ инстанса API) требуется
    Redis Pub/Sub для broadcast между серверами.

    Структура данных:
        _rooms = {
            1: {<WebSocket1>, <WebSocket2>, ...},
            2: {<WebSocket3>, ...},
        }
    """
    def __init__(self) -> None:
        self._rooms: dict[int, set[WebSocket]] = {}

    # Подключение клиента к комнате
    async def connect(self, ws: WebSocket, room_id: int) -> None:
        """
        1. Принимаем WebSocket соединение (handshake)
        2. Добавляем сокет в набор активных подключений комнаты
        """
        await ws.accept()
        self._rooms.setdefault(room_id, set()).add(ws)

    # Отключение клиента от комнаты
    def disconnect(self, ws: WebSocket, room_id: int) -> None:
        """
        Вызывается при закрытии WebSocket соединения.
        Если комната становится пустой — удаляем её из словаря для экономии памяти.
        """
        room = self._rooms.get(room_id)
        if not room:
            return
        room.discard(ws)
        if not room:
            self._rooms.pop(room_id, None)

    # Отправка сообщения всем клиентам в комнате.
    async def broadcast(self, room_id: int, payload: dict) -> None: # TODO: Вместо payload словаря - сделать pydantic типизацию
        """
        1. Получаем набор активных соединений в комнате
        2. Пытаемся отправить JSON каждому клиенту
        3. Если отправка не удалась (клиент отключился) — помечаем как "мёртвый"
        4. Удаляем мёртвые соединения из комнаты
        5. Смерть - это не шутки...
        """
        room = self._rooms.get(room_id, set())
        dead: list[WebSocket] = [] # Список для накопления мёртвых соединений

        for ws in room:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)

        for ws in dead:
            self.disconnect(ws, room_id)


manager = ConnectionManager()

# WebSocket endpoint для real-time обмена сообщениями в комнате.
@router.websocket("/ws/rooms/{room_id}")
async def ws_room(ws: WebSocket, room_id: int):
    """
    1. Клиент подключается → accept + добавление в менеджер
    2. Цикл: получение сообщений → валидация → сохранение → broadcast
    3. Клиент отключается (WebSocketDisconnect) → удаление из менеджера
    """
    await manager.connect(ws, room_id)

    try:
        async with SessionLocal() as db:
            while True:
                data = await ws.receive_json()

                # === ВАЛИДАЦИЯ ===
                try:
                    payload = MessageCreate(**data)
                except ValidationError as e:
                    await ws.send_json(
                        {"type": "error", "error": "validation", "detail": e.errors()}
                    )
                    continue

                msg = await create_message_with_nonce(db=db, room_id=room_id, payload=payload) # TODO:  Вместо payload словаря - сделать pydantic типизацию

                # === BROADCAST ===
                # Отправляем новое сообщение всем клиентам в комнате
                await manager.broadcast(
                    room_id,
                    {
                        "type": "message.new",
                        "message": {
                            "id": msg.id,
                            "room_id": msg.room_id,
                            "nonce": msg.nonce,
                            "author": msg.author,
                            "body": msg.body,
                            "created_at": msg.created_at.isoformat(),
                        },
                    },
                )

    except WebSocketDisconnect:
        manager.disconnect(ws, room_id)
