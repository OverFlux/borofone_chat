"""Server membership and ID-based discovery endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user
from app.infra.db import get_db
from app.models import Server, ServerMember, User
from app.schemas.auth import UserProfileResponse
from app.schemas.servers import (
    ServerCreate,
    ServerMemberResponse,
    ServerResponse,
    ServerTransferOwner,
    ServerUpdate,
)
from app.services.access import get_server_member, require_server_member


router = APIRouter(tags=["Servers"])


def _server_response(server: Server, *, is_member: bool, member_count: int | None = None) -> ServerResponse:
    return ServerResponse(
        id=server.id,
        name=server.name,
        owner_id=server.owner_id,
        is_joinable=server.is_joinable,
        created_at=server.created_at.isoformat(),
        is_member=is_member,
        member_count=member_count,
    )


async def _require_server_owner(
    db: AsyncSession,
    server_id: int,
    current_user: User,
) -> Server:
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Server owner role required")
    return server


@router.get("/servers", response_model=list[ServerResponse])
async def list_my_servers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Server)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(ServerMember.user_id == current_user.id)
        .order_by(Server.created_at.asc())
    )
    return [_server_response(server, is_member=True) for server in result.scalars().all()]


@router.post("/servers", response_model=ServerResponse, status_code=status.HTTP_201_CREATED)
async def create_server(
    payload: ServerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = Server(
        name=payload.name,
        owner_id=current_user.id,
        is_joinable=payload.is_joinable,
    )
    db.add(server)
    await db.flush()
    db.add(ServerMember(server_id=server.id, user_id=current_user.id, role="owner"))
    await db.commit()
    await db.refresh(server)
    return _server_response(server, is_member=True, member_count=1)


@router.get("/servers/{server_id}", response_model=ServerResponse)
async def find_server_by_id(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    member = await get_server_member(db, server_id, current_user.id)
    return _server_response(server, is_member=member is not None)


@router.patch("/servers/{server_id}", response_model=ServerResponse)
async def update_server(
    server_id: int,
    payload: ServerUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = await _require_server_owner(db, server_id, current_user)
    if payload.name is not None:
        server.name = payload.name
    if payload.is_joinable is not None:
        server.is_joinable = payload.is_joinable
    await db.commit()
    await db.refresh(server)
    return _server_response(server, is_member=True)


@router.post("/servers/{server_id}/transfer", response_model=ServerResponse)
async def transfer_server_owner(
    server_id: int,
    payload: ServerTransferOwner,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = await _require_server_owner(db, server_id, current_user)
    if payload.new_owner_id == server.owner_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User already owns this server")

    new_owner = await get_server_member(db, server_id, payload.new_owner_id)
    if not new_owner:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New owner must be a server member")
    previous_owner = (
        await get_server_member(db, server_id, server.owner_id)
        if server.owner_id is not None
        else None
    )
    if previous_owner:
        previous_owner.role = "member"
    new_owner.role = "owner"
    server.owner_id = payload.new_owner_id
    await db.commit()
    await db.refresh(server)
    return _server_response(server, is_member=True)


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = await _require_server_owner(db, server_id, current_user)
    await db.delete(server)
    await db.commit()


@router.post("/servers/{server_id}/join", response_model=ServerResponse)
async def join_server(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    existing = await get_server_member(db, server_id, current_user.id)
    if existing:
        return _server_response(server, is_member=True)
    if not server.is_joinable:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Server is invite-only")

    db.add(ServerMember(server_id=server.id, user_id=current_user.id, role="member"))
    await db.commit()
    return _server_response(server, is_member=True)


@router.post("/servers/{server_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_server(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = await db.get(Server, server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if server.owner_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Transfer ownership before leaving")
    member = await require_server_member(db, server_id, current_user)
    await db.delete(member)
    await db.commit()


@router.get("/servers/{server_id}/members", response_model=list[ServerMemberResponse])
async def list_server_members(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await require_server_member(db, server_id, current_user)
    result = await db.execute(
        select(ServerMember, User)
        .join(User, User.id == ServerMember.user_id)
        .where(ServerMember.server_id == server_id, User.is_active.is_(True))
        .order_by(User.username.asc())
    )
    return [
        ServerMemberResponse(
            user_id=user.id,
            username=user.username,
            display_name=user.display_name,
            avatar_url=user.avatar_url,
            role=member.role,
            is_online=user.is_online,
            joined_at=member.joined_at.isoformat(),
        )
        for member, user in result.all()
    ]


@router.get("/users/{user_id}", response_model=UserProfileResponse)
async def find_user_by_id(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserProfileResponse(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
    )
