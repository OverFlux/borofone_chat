from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user
from app.infra.db import get_db
from app.models import User, VoiceRoom
from app.schemas.voice import VoiceRoomCreate, VoiceRoomResponse

router = APIRouter(prefix="/voice-rooms", tags=["Voice Rooms"])


def _to_response(room: VoiceRoom) -> VoiceRoomResponse:
    return VoiceRoomResponse(
        id=room.id,
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
    room = VoiceRoom(name=payload.name.strip(), created_by=current_user.id, is_active=True)
    db.add(room)
    await db.commit()
    room = (await db.execute(select(VoiceRoom).where(VoiceRoom.id == room.id))).scalar_one()
    return _to_response(room)


@router.get("", response_model=list[VoiceRoomResponse])
async def list_voice_rooms(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(VoiceRoom).where(VoiceRoom.is_active.is_(True)).order_by(VoiceRoom.created_at.desc())
    )
    return [_to_response(r) for r in result.scalars().all()]


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voice_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await db.get(VoiceRoom, room_id)
    if not room or not room.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice room not found")

    if room.created_by != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")

    room.is_active = False
    await db.commit()
