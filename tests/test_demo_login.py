import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException, Response

from app.api.auth import demo_login
from app.models import Room, Server, ServerMember, User, VoiceRoom
from app.settings import settings


class _FakeResult:
    def __init__(self, value=None, values=None):
        self.value = value
        self.values = values or []

    def scalar_one_or_none(self):
        return self.value

    def scalars(self):
        return self

    def all(self):
        return self.values


class _FakeDB:
    def __init__(self):
        self.user = None
        self.server = None
        self.membership = None
        self.room = None
        self.voice_rooms = []
        self.added = []
        self.commits = 0

    async def execute(self, statement):
        sql = str(statement)
        if "users.email" in sql:
            return _FakeResult(self.user)
        if "users.username" in sql:
            return _FakeResult(None)
        if "FROM servers" in sql:
            return _FakeResult(self.server)
        if "FROM server_members" in sql:
            return _FakeResult(self.membership)
        if "FROM rooms" in sql:
            return _FakeResult(self.room)
        if "voice_rooms.name" in sql:
            return _FakeResult(values=[room.name for room in self.voice_rooms])
        return _FakeResult()

    def add(self, value):
        self.added.append(value)
        if isinstance(value, User):
            self.user = value
        elif isinstance(value, Server):
            self.server = value
        elif isinstance(value, ServerMember):
            self.membership = value
        elif isinstance(value, Room):
            self.room = value
        elif isinstance(value, VoiceRoom):
            self.voice_rooms.append(value)

    async def flush(self):
        if self.user and self.user.id is None:
            self.user.id = 184
            self.user.created_at = datetime.now(timezone.utc)
            self.user.updated_at = datetime.now(timezone.utc)
        if self.server and self.server.id is None:
            self.server.id = 7
            self.server.created_at = datetime.now(timezone.utc)

    async def commit(self):
        self.commits += 1

    async def refresh(self, value):
        return None


def test_demo_login_creates_user_and_sets_cookie_session(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "development")
    db = _FakeDB()
    response = Response()

    result = asyncio.run(demo_login(response, db))

    assert result["user"] == {
        "id": 184,
        "username": "borotalk_demo",
        "display_name": "Demo User",
    }
    assert result["server_id"] == 7
    assert any(isinstance(item, Server) for item in db.added)
    assert any(isinstance(item, ServerMember) for item in db.added)
    assert any(isinstance(item, Room) for item in db.added)
    assert len([item for item in db.added if isinstance(item, VoiceRoom)]) == 3
    cookies = response.headers.getlist("set-cookie")
    assert any(cookie.startswith("access_token=") for cookie in cookies)
    assert any(cookie.startswith("refresh_token=") for cookie in cookies)


def test_demo_login_is_hidden_outside_development(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(demo_login(Response(), _FakeDB()))

    assert exc.value.status_code == 404
