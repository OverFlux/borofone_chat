import asyncio
from datetime import datetime, timezone

import pytest

from app.api.direct_messages import (
    create_or_get_direct_conversation,
    list_direct_conversations,
    list_direct_messages,
    post_direct_message,
)
from app.models import DirectConversation, DirectMessage, User
from app.schemas.direct_messages import DirectMessageCreate


class FakeResult:
    def __init__(self, values):
        self.values = values

    def scalar_one_or_none(self):
        return self.values[0] if self.values else None

    def scalar_one(self):
        return self.values[0]

    def scalars(self):
        return self

    def all(self):
        return self.values


class FakeDB:
    def __init__(self, users):
        self.users = {user.id: user for user in users}
        self.conversations = {}
        self.messages = {}

    async def get(self, model, item_id):
        if model is User:
            return self.users.get(item_id)
        if model is DirectConversation:
            return self.conversations.get(item_id)
        return None

    async def execute(self, statement):
        sql = str(statement)
        if "FROM direct_conversations" in sql:
            return FakeResult(list(self.conversations.values()))
        if "FROM direct_messages" in sql:
            return FakeResult(list(self.messages.values()))
        if "FROM users" in sql:
            return FakeResult(list(self.users.values()))
        return FakeResult([])

    def add(self, value):
        now = datetime.now(timezone.utc)
        if isinstance(value, DirectConversation):
            value.id = len(self.conversations) + 1
            value.created_at = now
            self.conversations[value.id] = value
        elif isinstance(value, DirectMessage):
            value.id = len(self.messages) + 1
            value.created_at = now
            self.messages[value.id] = value

    async def commit(self):
        return None

    async def rollback(self):
        return None

    async def refresh(self, value):
        return None


def make_user(user_id, username):
    return User(
        id=user_id,
        email=f"{username}@example.com",
        password_hash="hash",
        username=username,
        display_name=username.title(),
        role="member",
        is_active=True,
    )


def test_direct_conversation_and_messages_are_private():
    alice = make_user(1, "alice")
    bob = make_user(2, "bob")
    charlie = make_user(3, "charlie")
    db = FakeDB([alice, bob, charlie])

    conversation = asyncio.run(create_or_get_direct_conversation(bob.id, db, alice))
    assert conversation.peer_id == bob.id

    conversations = asyncio.run(list_direct_conversations(db, alice))
    assert [item.id for item in conversations] == [conversation.id]

    message = asyncio.run(
        post_direct_message(
            conversation.id,
            DirectMessageCreate(body="  Привет  ", nonce="demo-1"),
            db,
            alice,
            None,
        )
    )
    assert message.body == "Привет"

    messages = asyncio.run(list_direct_messages(conversation.id, 50, None, db, bob))
    assert [item.body for item in messages] == ["Привет"]

    with pytest.raises(Exception) as forbidden:
        asyncio.run(list_direct_messages(conversation.id, 50, None, db, charlie))
    assert getattr(forbidden.value, "status_code", None) == 403
