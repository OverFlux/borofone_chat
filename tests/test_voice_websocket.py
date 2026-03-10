from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import ws as ws_module
from app.models import User
from app.security import create_access_token
from app.services.voice import voice_runtime


class FakeDB:
    def __init__(self, user):
        self.user = user

    async def get(self, model, user_id):
        if model is User and user_id == self.user.id:
            return self.user
        return None

    async def commit(self):
        return None

    async def rollback(self):
        return None


class FakeSessionLocal:
    def __init__(self, db):
        self.db = db

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, exc_type, exc, tb):
        return False


async def _noop(*args, **kwargs):
    return None


def test_voice_websocket_join_screen_share_and_leave(monkeypatch):
    voice_runtime._rooms.clear()
    voice_runtime._connections.clear()
    voice_runtime._user_room.clear()

    user = User(
        id=1,
        email="u1@example.com",
        password_hash="hash",
        username="alice",
        display_name="Alice",
        avatar_url="/uploads/avatars/alice.png",
        role="member",
        is_active=True,
    )

    monkeypatch.setattr(ws_module, "SessionLocal", FakeSessionLocal(FakeDB(user)))
    monkeypatch.setattr("app.services.presence.set_user_online", _noop)
    monkeypatch.setattr("app.services.presence.set_user_offline", _noop)
    monkeypatch.setattr("app.infra.redis.get_redis_client", lambda: None)

    app = FastAPI()
    app.include_router(ws_module.router)
    token = create_access_token({"sub": str(user.id)})

    with TestClient(app) as client:
        with client.websocket_connect(f"/ws?token={token}") as websocket:
            connected = websocket.receive_json()
            assert connected == {"type": "connected", "user": {"id": user.id}}

            websocket.send_json({"type": "join_room", "room_id": 77})

            room_joined = websocket.receive_json()
            assert room_joined["type"] == "room_joined"
            assert room_joined["room_id"] == 77
            assert room_joined["participants"] == [
                {
                    "room_id": 77,
                    "user_id": user.id,
                    "username": user.username,
                    "display_name": user.display_name,
                    "avatar_url": user.avatar_url,
                    "joined_at": room_joined["participants"][0]["joined_at"],
                    "muted": False,
                    "deafened": False,
                    "speaking": False,
                    "screen_sharing": False,
                }
            ]

            participant_joined = websocket.receive_json()
            assert participant_joined["type"] == "participant_joined"
            assert participant_joined["participant"]["avatar_url"] == user.avatar_url
            assert participant_joined["participant"]["screen_sharing"] is False

            presence = websocket.receive_json()
            assert presence["type"] == "voice_room_presence"
            assert presence["room_id"] == 77
            assert len(presence["participants"]) == 1

            websocket.send_json({"type": "set_screen_share", "room_id": 77, "sharing": True})

            sharing_update = websocket.receive_json()
            assert sharing_update["type"] == "screen_share_updated"
            assert sharing_update["room_id"] == 77
            assert sharing_update["user_id"] == user.id
            assert sharing_update["screen_sharing"] is True
            assert sharing_update["participant"]["screen_sharing"] is True

            websocket.send_json({"type": "leave_room", "room_id": 77})

            empty_presence = websocket.receive_json()
            assert empty_presence == {
                "type": "voice_room_presence",
                "room_id": 77,
                "participants": [],
            }

    assert voice_runtime._rooms == {}
    assert voice_runtime._user_room == {}
    assert voice_runtime._connections == {}
