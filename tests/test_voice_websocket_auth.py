import asyncio

from app.api.ws import get_user_from_websocket
from app.models import User
from app.security import create_access_token


class FakeDB:
    def __init__(self, users):
        self.users = users

    async def get(self, model, user_id):
        return self.users.get(user_id)


class FakeWS:
    pass


def test_get_user_from_websocket_auth_paths():
    active = User(
        id=1,
        email="u1@example.com",
        password_hash="hash",
        username="u1",
        display_name="User 1",
        role="member",
        is_active=True,
    )
    disabled = User(
        id=2,
        email="u2@example.com",
        password_hash="hash",
        username="u2",
        display_name="User 2",
        role="member",
        is_active=False,
    )

    db = FakeDB({1: active, 2: disabled})
    ws = FakeWS()

    valid = create_access_token({"sub": "1"})
    disabled_token = create_access_token({"sub": "2"})

    user = asyncio.run(get_user_from_websocket(ws, db, token_cookie=valid, token_query=None))
    assert user is not None and user.id == 1

    no_token = asyncio.run(get_user_from_websocket(ws, db, token_cookie=None, token_query=None))
    assert no_token is None

    invalid = asyncio.run(get_user_from_websocket(ws, db, token_cookie="bad", token_query=None))
    assert invalid is None

    disabled_user = asyncio.run(get_user_from_websocket(ws, db, token_cookie=disabled_token, token_query=None))
    assert disabled_user is None
