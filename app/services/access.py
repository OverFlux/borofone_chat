"""Authorization helpers for the server-scoped Borotalk model."""

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Room, Server, ServerMember, User, VoiceRoom


async def get_server_member(
    db: AsyncSession, server_id: int, user_id: int
) -> ServerMember | None:
    result = await db.execute(
        select(ServerMember).where(
            ServerMember.server_id == server_id,
            ServerMember.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def require_server_member(db: AsyncSession, server_id: int, user: User) -> ServerMember:
    member = await get_server_member(db, server_id, user.id)
    if not member:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a server member")
    return member


async def require_server_manager(db: AsyncSession, server_id: int, user: User) -> ServerMember:
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")

    member = await require_server_member(db, server_id, user)
    if user.role == "admin" or server.owner_id == user.id or member.role in {"owner", "admin"}:
        return member
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Server manager role required")


async def require_room_member(db: AsyncSession, room_id: int, user: User) -> Room:
    room = await db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Room not found")
    await require_server_member(db, room.server_id, user)
    return room


async def require_voice_room_member(db: AsyncSession, room_id: int, user: User) -> VoiceRoom:
    room = await db.get(VoiceRoom, room_id)
    if not room or not room.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice room not found")
    await require_server_member(db, room.server_id, user)
    return room


async def server_ids_for_user(db: AsyncSession, user_id: int) -> set[int]:
    result = await db.execute(select(ServerMember.server_id).where(ServerMember.user_id == user_id))
    return set(result.scalars().all())
