from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.dependencies import get_current_user
from app.infra.db import get_db
from app.models import Room, ServerMember, User
from app.schemas.rooms import RoomCreate, RoomResponse
from app.services.access import require_room_member, require_server_manager, require_server_member
from app.services.presence import get_all_users_with_status, set_user_online, set_user_offline, check_and_update_offline_users

router = APIRouter(prefix="/rooms", tags=["Rooms"])


def _room_to_response(room: Room) -> RoomResponse:
    return RoomResponse(
        id=room.id,
        server_id=room.server_id,
        title=room.title,
        description=room.description,
        created_at=room.created_at.isoformat(),
    )


@router.get("", response_model=list[RoomResponse])
async def list_rooms(
    server_id: int = Query(..., gt=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await require_server_member(db, server_id, current_user)
    result = await db.execute(
        select(Room)
        .where(Room.server_id == server_id)
        .order_by(Room.created_at.asc())
    )
    return [_room_to_response(r) for r in result.scalars().all()]


@router.post("", response_model=RoomResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
    payload: RoomCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await require_server_manager(db, payload.server_id, current_user)

    room = Room(
        server_id=payload.server_id,
        title=payload.title,
        description=payload.description,
        created_by=current_user.id,
    )
    db.add(room)
    await db.commit()

    # Явный SELECT после commit — гарантирует все server-default поля (created_at и др.)
    room = (await db.execute(select(Room).where(Room.id == room.id))).scalar_one()

    return _room_to_response(room)


@router.get("/{room_id}", response_model=RoomResponse)
async def get_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await require_room_member(db, room_id, current_user)
    return _room_to_response(room)


@router.get("/{room_id}/online", response_model=list[dict])
async def get_online_users_in_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Получить список онлайн пользователей (глобально, не по комнатам).
    
    Returns:
        List[dict]: Список пользователей с полями id, username, display_name, avatar_url
    """
    room = await require_room_member(db, room_id, current_user)
    stmt = (
        select(User)
        .join(ServerMember, ServerMember.user_id == User.id)
        .where(
            ServerMember.server_id == room.server_id,
            User.is_online.is_(True),
            User.is_active.is_(True),
        )
    )
    result = await db.execute(stmt)
    users = result.scalars().all()
    
    return [
        {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "avatar_url": user.avatar_url,
            "role": user.role,
        }
        for user in users
    ]


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    room = await require_room_member(db, room_id, current_user)
    await require_server_manager(db, room.server_id, current_user)

    await db.delete(room)
    await db.commit()


@router.get("/{room_id}/users")
async def get_all_users(
    room_id: int,
    status: Optional[str] = Query(None, description="Фильтр: online, offline"),
    search: Optional[str] = Query(None, description="Поиск по имени"),
    sort_by: str = Query("last_seen", description="Сортировка: last_seen, username, display_name"),
    sort_order: str = Query("desc", description="Порядок: asc, desc"),
    limit: int = Query(50, ge=1, le=100, description="Лимит"),
    offset: int = Query(0, ge=0, description="Смещение"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Получить всех пользователей с разделением на онлайн/оффлайн (глобальный статус).
    
    Поддерживает:
    - Фильтрацию по статусу (online/offline)
    - Поиск по username и display_name
    - Сортировку по последней активности, имени или отображаемому имени
    - Пагинацию
    """
    room = await require_room_member(db, room_id, current_user)
    users, total = await get_all_users_with_status(
        db=db,
        room_id=room.id,
        server_id=room.server_id,
        status_filter=status,
        search_query=search,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
    )
    
    return {
        "users": users,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/{room_id}/users/{user_id}/online")
async def mark_user_online(
    room_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Отметить пользователя как онлайн (вызывается при входе в комнату)."""
    await require_room_member(db, room_id, current_user)
    if user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change another user's status")
    await set_user_online(db, user_id)
    return {"status": "ok", "user_id": user_id, "is_online": True}


@router.post("/{room_id}/users/{user_id}/offline")
async def mark_user_offline(
    room_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Отметить пользователя как оффлайн (вызывается при выходе из комнаты)."""
    await require_room_member(db, room_id, current_user)
    if user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change another user's status")
    await set_user_offline(db, user_id)
    return {"status": "ok", "user_id": user_id, "is_online": False}


@router.post("/{room_id}/users/sync")
async def sync_users_status(
    room_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Синхронизировать статусы пользователей (проверить кто оффлайн)."""
    await require_room_member(db, room_id, current_user)
    from app.infra.redis import get_redis_client
    redis = get_redis_client()
    await check_and_update_offline_users(db, redis)
    return {"status": "synced"}
