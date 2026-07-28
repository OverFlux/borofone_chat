import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.schemas.direct_messages import DirectMessageCreate
from app.schemas.messages import MessageCreate
from app.services.message_rate_limit import (
    MESSAGE_BURST_LIMIT,
    enforce_message_rate_limit,
)


def test_local_message_limit_allows_normal_chat_and_stops_burst():
    user_id = 9184
    for index in range(MESSAGE_BURST_LIMIT):
        asyncio.run(
            enforce_message_rate_limit(
                None,
                user_id,
                now=1000 + index * 0.1,
            )
        )

    with pytest.raises(HTTPException) as limited:
        asyncio.run(enforce_message_rate_limit(None, user_id, now=1001))

    assert limited.value.status_code == 429
    assert limited.value.headers["Retry-After"] == "10"
    assert "Слишком много сообщений" in limited.value.detail

    asyncio.run(enforce_message_rate_limit(None, user_id, now=1011))


def test_message_body_limit_is_2000_characters():
    assert len(MessageCreate(body="x" * 2000).body) == 2000
    assert len(DirectMessageCreate(body="x" * 2000).body) == 2000

    with pytest.raises(ValidationError):
        MessageCreate(body="x" * 2001)
    with pytest.raises(ValidationError):
        DirectMessageCreate(body="x" * 2001)
