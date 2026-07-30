import asyncio
from datetime import datetime, timezone

import pytest

from app.api import servers as servers_api
from app.models import Server, ServerMember, User
from app.schemas.servers import ServerTransferOwner, ServerUpdate


class FakeDB:
    def __init__(self, server):
        self.server = server
        self.deleted = None
        self.commits = 0

    async def get(self, model, object_id):
        if model is Server and object_id == self.server.id:
            return self.server
        return None

    async def commit(self):
        self.commits += 1

    async def refresh(self, instance):
        return None

    async def delete(self, instance):
        self.deleted = instance


def make_user(user_id):
    return User(
        id=user_id,
        email=f"user{user_id}@example.com",
        password_hash="hash",
        username=f"user{user_id}",
        display_name=f"User {user_id}",
        role="member",
        is_active=True,
    )


def test_server_update_transfer_and_delete(monkeypatch):
    owner = make_user(1)
    next_owner = make_user(2)
    server = Server(
        id=7,
        name="Friends",
        owner_id=owner.id,
        is_joinable=True,
        created_at=datetime.now(timezone.utc),
    )
    memberships = {
        owner.id: ServerMember(id=1, server_id=server.id, user_id=owner.id, role="owner"),
        next_owner.id: ServerMember(id=2, server_id=server.id, user_id=next_owner.id, role="member"),
    }
    db = FakeDB(server)

    async def fake_get_server_member(_db, server_id, user_id):
        assert server_id == server.id
        return memberships.get(user_id)

    async def fake_get(model, object_id):
        if model is Server and object_id == server.id:
            return server
        if model is User and object_id == next_owner.id:
            return next_owner
        return None

    async def fake_ensure_owner_capacity(_db, _user):
        return None

    db.get = fake_get
    monkeypatch.setattr(servers_api, "get_server_member", fake_get_server_member)
    monkeypatch.setattr(servers_api, "_ensure_owner_capacity", fake_ensure_owner_capacity)

    updated = asyncio.run(
        servers_api.update_server(
            server.id,
            ServerUpdate(name="  Nova friends  ", is_joinable=False),
            db,
            owner,
        ),
    )
    assert updated.name == "Nova friends"
    assert updated.is_joinable is False

    transferred = asyncio.run(
        servers_api.transfer_server_owner(
            server.id,
            ServerTransferOwner(new_owner_id=next_owner.id),
            db,
            owner,
        ),
    )
    assert transferred.owner_id == next_owner.id
    assert memberships[owner.id].role == "member"
    assert memberships[next_owner.id].role == "owner"

    with pytest.raises(Exception) as forbidden:
        asyncio.run(
            servers_api.update_server(
                server.id,
                ServerUpdate(name="No access"),
                db,
                owner,
            ),
        )
    assert getattr(forbidden.value, "status_code", None) == 403

    asyncio.run(servers_api.delete_server(server.id, db, next_owner))
    assert db.deleted is server
    assert db.commits == 3
