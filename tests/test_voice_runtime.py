import asyncio

from app.services.voice import VoiceRuntime


def test_voice_runtime_join_update_leave_flow():
    runtime = VoiceRuntime()

    snapshot, participant, prev_room_id, prev_participant = asyncio.run(
        runtime.join_room(room_id=10, user_id=1, username="alice", display_name="Alice")
    )

    assert prev_room_id is None
    assert prev_participant is None
    assert len(snapshot) == 1
    assert snapshot[0]["user_id"] == 1
    assert participant.room_id == 10

    updated = asyncio.run(runtime.update_state(10, 1, muted=True, speaking=False))
    assert updated is not None
    assert updated.muted is True
    assert updated.speaking is False

    updated = asyncio.run(runtime.update_state(10, 1, deafened=True, speaking=True))
    assert updated is not None
    assert updated.deafened is True
    assert updated.speaking is True

    participants = asyncio.run(runtime.participants_snapshot(10))
    assert participants == [
        {
            "room_id": 10,
            "user_id": 1,
            "username": "alice",
            "display_name": "Alice",
            "joined_at": participant.joined_at,
            "muted": True,
            "deafened": True,
            "speaking": True,
        }
    ]

    left = asyncio.run(runtime.leave_room(10, 1))
    assert left is not None
    assert left.user_id == 1
    assert asyncio.run(runtime.participants_snapshot(10)) == []


def test_voice_runtime_moving_between_rooms_and_unregister_connection():
    runtime = VoiceRuntime()
    sock1 = object()
    sock2 = object()

    asyncio.run(runtime.register_connection(1, sock1))
    asyncio.run(runtime.register_connection(1, sock2))

    _, _, prev_room_id, prev_participant = asyncio.run(runtime.join_room(1, 1, "alice", "Alice"))
    assert prev_room_id is None
    assert prev_participant is None

    snapshot, participant, prev_room_id, prev_participant = asyncio.run(runtime.join_room(2, 1, "alice", "Alice"))
    assert participant.room_id == 2
    assert prev_room_id == 1
    assert prev_participant is not None
    assert prev_participant.room_id == 1
    assert len(snapshot) == 1

    room_sockets = asyncio.run(runtime.sockets_for_room(2))
    assert set(room_sockets) == {sock1, sock2}
    all_sockets = asyncio.run(runtime.sockets_all())
    assert set(all_sockets) == {sock1, sock2}

    room_id, participant = asyncio.run(runtime.unregister_connection(1, sock1))
    assert room_id is None
    assert participant is None

    room_id, participant = asyncio.run(runtime.unregister_connection(1, sock2))
    assert room_id == 2
    assert participant is not None
    assert participant.user_id == 1
    assert asyncio.run(runtime.sockets_for_user(1)) == []
