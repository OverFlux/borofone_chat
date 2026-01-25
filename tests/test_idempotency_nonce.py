import asyncio
import uuid

import pytest
from app.infra.redis import redis_client

async def _mk_room(ac) -> int:
    r = await ac.post("/rooms", json={"title": f"room-{uuid.uuid4()}"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def _list_messages(ac, room_id: int) -> list[dict]:
    r = await ac.get(f"/rooms/{room_id}/messages?limit=50")
    assert r.status_code == 200, r.text
    return r.json()


async def _post_message(ac, room_id: int, payload: dict):
    return await ac.post(f"/rooms/{room_id}/messages", json=payload)


@pytest.mark.asyncio
async def test_nonce_enforce_returns_same_id(ac):
    room_id = await _mk_room(ac)

    nonce = f"n-{uuid.uuid4().hex[:10]}"
    payload = {"nonce": nonce, "enforce_nonce": True, "author": "u1", "body": "hi"}

    r1 = await _post_message(ac, room_id, payload)
    assert r1.status_code == 200, r1.text
    id1 = r1.json()["id"]

    key = f"nonce:{payload['author']}:{payload['nonce']}"
    val = await redis_client.get(key)
    ttl = await redis_client.ttl(key)

    assert val is not None
    assert int(val) == id1
    assert ttl > 0

    r2 = await _post_message(ac, room_id, payload)
    assert r2.status_code == 200, r2.text
    id2 = r2.json()["id"]

    assert id1 == id2

    msgs = await _list_messages(ac, room_id)
    assert len(msgs) == 1


@pytest.mark.asyncio
async def test_nonce_no_enforce_creates_two(ac):
    room_id = await _mk_room(ac)

    nonce = f"n-{uuid.uuid4().hex[:10]}"
    payload = {"nonce": nonce, "enforce_nonce": False, "author": "u1", "body": "hi"}

    r1 = await _post_message(ac, room_id, payload)
    assert r1.status_code == 200, r1.text
    id1 = r1.json()["id"]

    r2 = await _post_message(ac, room_id, payload)
    assert r2.status_code == 200, r2.text
    id2 = r2.json()["id"]

    assert id1 != id2

    msgs = await _list_messages(ac, room_id)
    assert len(msgs) == 2


@pytest.mark.asyncio
async def test_enforce_requires_nonce(ac):
    room_id = await _mk_room(ac)

    payload = {"enforce_nonce": True, "author": "u1", "body": "hi"}  # nonce отсутствует
    r = await _post_message(ac, room_id, payload)

    # 422 если валидирует pydantic, 400 если ты выбрасываешь HTTPException вручную
    assert r.status_code in (400, 422), r.text


@pytest.mark.asyncio
async def test_concurrent_nonce(ac):
    room_id = await _mk_room(ac)

    nonce = f"race-{uuid.uuid4().hex[:10]}"
    payload = {"nonce": nonce, "enforce_nonce": True, "author": "u1", "body": "hi"}

    r1, r2 = await asyncio.gather(
        _post_message(ac, room_id, payload),
        _post_message(ac, room_id, payload),
    )

    codes = sorted([r1.status_code, r2.status_code])
    assert codes in ([200, 200], [200, 409]), (r1.status_code, r1.text, r2.status_code, r2.text)

    if r1.status_code == 200 and r2.status_code == 200:
        assert r1.json()["id"] == r2.json()["id"]

    msgs = await _list_messages(ac, room_id)
    assert len(msgs) == 1
