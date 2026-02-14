"""
Rooms API endpoints.

Endpoints:
- GET /rooms - список всех комнат
- POST /rooms - создание новой комнаты
- GET /rooms/{id} - информация о комнате
- GET /rooms/{id}/messages - сообщения комнаты
- POST /rooms/{id}/messages - отправка сообщения
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user
from app.infra.db import get_db
from app.models import Room, User
from app.schemas.rooms import RoomCreate, RoomResponse

router = APIRouter(prefix="/rooms", tags=["Rooms"])


@router.get("", response_model=list[RoomResponse])
async def list_rooms(
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    """
    Получение списка всех комнат.

    Returns:
        List[RoomResponse]: Список комнат
    """
    stmt = select(Room).order_by(Room.created_at.asc())
    result = await db.execute(stmt)
    rooms = result.scalars().all()

    return [
        RoomResponse(
            id=room.id,
            title=room.title,
            description=room.description,
            created_at=room.created_at.isoformat()
        )
        for room in rooms
    ]


@router.post("", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
        payload: RoomCreate,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    """
    Создание новой комнаты.

    Args:
        payload: RoomCreate с title и опциональным description

    Returns:
        RoomResponse: Созданная комната
    """
    room = Room(
        title=payload.title,
        description=payload.description,
        created_by=current_user.id
    )

    db.add(room)
    await db.commit()
    await db.refresh(room)

    return RoomResponse(
        id=room.id,
        title=room.title,
        description=room.description,
        created_at=room.created_at.isoformat()
    )


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(
        room_id: int,
        db: AsyncSession = Depends(get_db),
        current_user: User = Depends(get_current_user)
):
    """
    Получение информации о комнате.

    Args:
        room_id: ID комнаты

    Returns:
        RoomResponse: Информация о комнате
    """
    room = await db.get(Room, room_id)

    if not room:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Room not found"
        )

    return RoomResponse(
        id=room.id,
        title=room.title,
        description=room.description,
        created_at=room.created_at.isoformat()
    )
