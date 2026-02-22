import asyncio
from datetime import datetime, timezone

import pytest

from app.api.voice_rooms import create_voice_room, delete_voice_room, get_voice_room_participants, list_voice_rooms
from app.models import User, VoiceRoom
from app.schemas.voice import VoiceRoomCreate
from app.services.voice import voice_runtime


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalar_one(self):
        return self._rows[0]

    def scalars(self):
        return self

    def all(self):
        return self._rows


class FakeDB:
    def __init__(self):
        self.rooms = {}
        self._next_id = 1

    def add(self, room):
        if room.id is None:
            room.id = self._next_id
            self._next_id += 1
        if room.created_at is None:
            room.created_at = datetime.now(timezone.utc)
        self.rooms[room.id] = room

    async def commit(self):
        return None

    async def get(self, model, room_id):
        return self.rooms.get(room_id)

    async def execute(self, stmt):
        sql = str(stmt)
        if "WHERE voice_rooms.id" in sql:
            target_id = list(self.rooms.keys())[-1]
            return _FakeResult([self.rooms[target_id]])
        active = [r for r in self.rooms.values() if r.is_active]
        active.sort(key=lambda r: r.created_at, reverse=True)
        return _FakeResult(active)


def _mk_user(user_id, role="member"):
    return User(
        id=user_id,
        email=f"u{user_id}@example.com",
        password_hash="hash",
        username=f"u{user_id}",
        display_name=f"User {user_id}",
        role=role,
        is_active=True,
    )


@pytest.fixture(autouse=True)
def reset_voice_state():
    voice_runtime._rooms.clear()
    voice_runtime._connections.clear()
    voice_runtime._user_room.clear()


def test_voice_rooms_crud_and_permissions():
    db = FakeDB()
    owner = _mk_user(1)
    admin = _mk_user(2, role="admin")
    other = _mk_user(3)

    old_room = VoiceRoom(id=10, name="Old", created_by=owner.id, is_active=True, created_at=datetime(2023, 1, 1, tzinfo=timezone.utc))
    inactive = VoiceRoom(id=11, name="Inactive", created_by=owner.id, is_active=False, created_at=datetime(2023, 1, 2, tzinfo=timezone.utc))
    db.rooms[10] = old_room
    db.rooms[11] = inactive

    created = asyncio.run(create_voice_room(VoiceRoomCreate(name="  Team Call  "), db, owner))
    assert created.name == "Team Call"
    assert created.created_by == owner.id

    listed = asyncio.run(list_voice_rooms(db, owner))
    assert [r.id for r in listed][0] == created.id
    assert inactive.id not in [r.id for r in listed]

    with pytest.raises(Exception) as forbidden:
        asyncio.run(delete_voice_room(created.id, db, other))
    assert getattr(forbidden.value, "status_code", None) == 403

    asyncio.run(delete_voice_room(created.id, db, admin))
    assert db.rooms[created.id].is_active is False

    with pytest.raises(Exception) as not_found:
        asyncio.run(delete_voice_room(inactive.id, db, owner))
    assert getattr(not_found.value, "status_code", None) == 404


def test_voice_room_participants_snapshot_endpoint():
    db = FakeDB()
    owner = _mk_user(1)
    room = VoiceRoom(id=20, name="Daily", created_by=owner.id, is_active=True, created_at=datetime.now(timezone.utc))
    db.rooms[20] = room

    asyncio.run(voice_runtime.join_room(room.id, owner.id, owner.username, owner.display_name))
    participants = asyncio.run(get_voice_room_participants(room.id, db, owner))
    assert len(participants) == 1
    assert participants[0]["user_id"] == owner.id
