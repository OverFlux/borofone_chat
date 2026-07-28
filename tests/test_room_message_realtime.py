import asyncio
import json
from datetime import datetime, timezone

from app.api import http
from app.infra.redis import room_events_channel
from app.models import Message, User
from app.schemas.messages import MessageCreate


class FakeResult:
    def __init__(self, value):
        self.value = value

    def scalar_one(self):
        return self.value


class FakeDB:
    def __init__(self, message):
        self.message = message

    async def execute(self, _statement):
        return FakeResult(self.message)


class FakeRedis:
    def __init__(self):
        self.published = []

    async def publish(self, channel, payload):
        self.published.append((channel, json.loads(payload)))
        return 1


def make_user():
    return User(
        id=7,
        email="alice@example.com",
        password_hash="hash",
        username="alice",
        display_name="Alice",
        role="member",
        is_active=True,
    )


def test_rest_room_message_is_published_for_realtime_clients(monkeypatch):
    user = make_user()
    message = Message(
        id=31,
        room_id=12,
        user_id=user.id,
        body="Всем привет",
        nonce="room-message-1",
        created_at=datetime.now(timezone.utc),
    )
    message.user = user
    message.attachments = []
    message.reactions = []
    message.reply_to = None
    message.edited_at = None
    message.deleted_at = None

    async def allow_member(_db, _room_id, _user):
        return type("RoomAccess", (), {"server_id": 4})()

    async def return_message(**_kwargs):
        return message

    monkeypatch.setattr(http, "require_room_member", allow_member)
    monkeypatch.setattr(http, "create_message_with_nonce", return_message)
    redis = FakeRedis()

    response = asyncio.run(
        http.post_message(
            room_id=message.room_id,
            payload=MessageCreate(body=message.body, nonce=message.nonce),
            db=FakeDB(message),
            current_user=user,
            redis=redis,
        )
    )

    assert response.id == message.id
    assert redis.published == [
        (
            room_events_channel(message.room_id),
            {
                "type": "message",
                **response.model_dump(),
            },
        )
    ]
