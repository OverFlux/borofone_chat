from __future__ import annotations

import asyncio
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone


@dataclass
class VoiceParticipant:
    room_id: int
    user_id: int
    username: str
    display_name: str
    avatar_url: str | None
    joined_at: str
    server_id: int | None = None
    muted: bool = False
    deafened: bool = False
    speaking: bool = False
    screen_sharing: bool = False


class VoiceRuntime:
    def __init__(self) -> None:
        self._rooms: dict[int, dict[int, VoiceParticipant]] = defaultdict(dict)
        self._connections: dict[int, set] = defaultdict(set)
        self._connection_servers: dict[object, int] = {}
        self._user_room: dict[int, int] = {}
        self._lock = asyncio.Lock()

    async def register_connection(
        self,
        user_id: int,
        websocket,
        server_id: int | None = None,
    ) -> bool:
        async with self._lock:
            sockets = self._connections.get(user_id)
            was_online = bool(sockets)
            if sockets is None:
                sockets = set()
                self._connections[user_id] = sockets
            sockets.add(websocket)
            if server_id is not None:
                self._connection_servers[websocket] = server_id
            return not was_online

    async def unregister_connection(self, user_id: int, websocket) -> tuple[int | None, VoiceParticipant | None]:
        room_id, participant, _ = await self.unregister_connection_with_status(user_id, websocket)
        return room_id, participant

    async def unregister_connection_with_status(
        self, user_id: int, websocket
    ) -> tuple[int | None, VoiceParticipant | None, bool]:
        async with self._lock:
            sockets = self._connections.get(user_id)
            if sockets and websocket in sockets:
                sockets.remove(websocket)
                self._connection_servers.pop(websocket, None)
                if sockets:
                    return None, None, False
                self._connections.pop(user_id, None)
                room_id = self._user_room.pop(user_id, None)
                if room_id is None:
                    return None, None, True
                participant = self._rooms.get(room_id, {}).pop(user_id, None)
                if self._rooms.get(room_id) == {}:
                    self._rooms.pop(room_id, None)
                return room_id, participant, True
        return None, None, False

    async def join_room(
        self,
        room_id: int,
        user_id: int,
        username: str,
        display_name: str,
        avatar_url: str | None = None,
        server_id: int | None = None,
    ) -> tuple[list[dict], VoiceParticipant, int | None, VoiceParticipant | None]:
        async with self._lock:
            prev_room_id = self._user_room.get(user_id)
            prev_participant = None
            if prev_room_id is not None and prev_room_id != room_id:
                prev_participant = self._rooms.get(prev_room_id, {}).pop(user_id, None)
                if self._rooms.get(prev_room_id) == {}:
                    self._rooms.pop(prev_room_id, None)

            participant = self._rooms[room_id].get(user_id)
            if participant is None:
                participant = VoiceParticipant(
                    room_id=room_id,
                    user_id=user_id,
                    username=username,
                    display_name=display_name,
                    avatar_url=avatar_url,
                    joined_at=datetime.now(timezone.utc).isoformat(),
                    server_id=server_id,
                )
                self._rooms[room_id][user_id] = participant
            elif server_id is not None:
                participant.server_id = server_id
            self._user_room[user_id] = room_id
            snapshot = [self._as_dict(p) for p in self._rooms[room_id].values()]
            return snapshot, participant, prev_room_id, prev_participant

    async def leave_room(self, room_id: int, user_id: int) -> VoiceParticipant | None:
        async with self._lock:
            if self._user_room.get(user_id) == room_id:
                self._user_room.pop(user_id, None)
            participant = self._rooms.get(room_id, {}).pop(user_id, None)
            if self._rooms.get(room_id) == {}:
                self._rooms.pop(room_id, None)
            return participant

    async def update_state(
        self,
        room_id: int,
        user_id: int,
        *,
        muted: bool | None = None,
        deafened: bool | None = None,
        speaking: bool | None = None,
        screen_sharing: bool | None = None,
    ) -> VoiceParticipant | None:
        async with self._lock:
            participant = self._rooms.get(room_id, {}).get(user_id)
            if not participant:
                return None
            if muted is not None:
                participant.muted = muted
            if deafened is not None:
                participant.deafened = deafened
            if speaking is not None:
                participant.speaking = speaking
            if screen_sharing is not None:
                participant.screen_sharing = screen_sharing
            return participant

    async def participants_snapshot(self, room_id: int) -> list[dict]:
        async with self._lock:
            return [self._as_dict(p) for p in self._rooms.get(room_id, {}).values()]

    async def sockets_for_room(self, room_id: int) -> list:
        async with self._lock:
            participants = list(self._rooms.get(room_id, {}).values())
            room_server_id = participants[0].server_id if participants else None
            sockets = []
            for participant in participants:
                user_sockets = self._connections.get(participant.user_id, set())
                if room_server_id is None:
                    sockets.extend(user_sockets)
                else:
                    sockets.extend(
                        socket
                        for socket in user_sockets
                        if self._connection_servers.get(socket) == room_server_id
                    )
            return sockets

    async def sockets_for_user(self, user_id: int) -> list:
        async with self._lock:
            return list(self._connections.get(user_id, set()))

    async def sockets_for_user_in_server(self, user_id: int, server_id: int) -> list:
        async with self._lock:
            return [
                socket
                for socket in self._connections.get(user_id, set())
                if self._connection_servers.get(socket) == server_id
            ]

    async def sockets_for_server(self, server_id: int) -> list:
        async with self._lock:
            return [
                socket
                for sockets in self._connections.values()
                for socket in sockets
                if self._connection_servers.get(socket) == server_id
            ]

    async def sockets_all(self) -> list:
        async with self._lock:
            sockets = []
            for conns in self._connections.values():
                sockets.extend(conns)
            return sockets

    async def online_users_count(self, server_id: int | None = None) -> int:
        async with self._lock:
            if server_id is not None:
                return sum(
                    1
                    for sockets in self._connections.values()
                    if any(self._connection_servers.get(socket) == server_id for socket in sockets)
                )
            return len(self._connections)

    @staticmethod
    def _as_dict(participant: VoiceParticipant) -> dict:
        return {
            "room_id": participant.room_id,
            "user_id": participant.user_id,
            "username": participant.username,
            "display_name": participant.display_name,
            "avatar_url": participant.avatar_url,
            "joined_at": participant.joined_at,
            "muted": participant.muted,
            "deafened": participant.deafened,
            "speaking": participant.speaking,
            "screen_sharing": participant.screen_sharing,
        }


voice_runtime = VoiceRuntime()
