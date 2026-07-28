from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user
from app.infra.db import get_db
from app.models import User, VoiceRoom
from app.schemas.voice import VoiceRoomCreate, VoiceRoomResponse
from app.services.access import require_server_member, require_voice_room_member
from app.services.voice import voice_runtime

router = APIRouter(prefix="/voice-rooms", tags=["Voice Rooms"])


def _to_response(room: VoiceRoom) -> VoiceRoomResponse:
    return VoiceRoomResponse(
        id=room.id,
        server_id=room.server_id,
        name=room.name,
        created_by=room.created_by,
        created_at=room.created_at.isoformat(),
        is_active=room.is_active,
    )


@router.post("", response_model=VoiceRoomResponse, status_code=status.HTTP_201_CREATED)
async def create_voice_room(
    payload: VoiceRoomCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await require_server_member(db, payload.server_id, current_user)
    room = VoiceRoom(
        server_id=payload.server_id,
        name=payload.name.strip(),
        created_by=current_user.id,
        is_active=True,
    )
    db.add(room)
    await db.commit()
    room = (await db.execute(select(VoiceRoom).where(VoiceRoom.id == room.id))).scalar_one()
    return _to_response(room)


@router.get("", response_model=list[VoiceRoomResponse])
async def list_voice_rooms(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await require_server_member(db, server_id, current_user)
    result = await db.execute(
        select(VoiceRoom)
        .where(VoiceRoom.server_id == server_id, VoiceRoom.is_active.is_(True))
        .order_by(VoiceRoom.created_at.asc())
    )
    return [_to_response(r) for r in result.scalars().all()]


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voice_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await require_voice_room_member(db, room_id, current_user)

    if room.created_by != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    room.is_active = False
    await db.commit()


@router.get("/{room_id}/participants", response_model=list[dict])
async def get_voice_room_participants(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await require_voice_room_member(db, room_id, current_user)
    return await voice_runtime.participants_snapshot(room_id)
