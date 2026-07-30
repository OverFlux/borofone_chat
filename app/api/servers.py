"""Private server membership, invites and approval requests."""

import json
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_user
from app.infra.db import get_db
from app.infra.redis import get_redis_client, user_events_channel
from app.models import Server, ServerInvite, ServerJoinRequest, ServerMember, User
from app.schemas.auth import UserProfileResponse
from app.schemas.servers import (
    ServerCreate,
    ServerMemberResponse,
    ServerResponse,
    ServerTransferOwner,
    ServerUpdate,
)
from app.schemas.platform import (
    JoinRequestReview,
    ServerInviteCreate,
    ServerInviteResponse,
    ServerJoinRequestResponse,
)
from app.security import generate_public_id
from app.services.access import get_server_member, require_server_member
from app.services.platform import utcnow
from app.settings import settings


router = APIRouter(tags=["Servers"])


def _server_response(server: Server, *, is_member: bool, member_count: int | None = None) -> ServerResponse:
    return ServerResponse(
        id=server.id,
        public_id=server.public_id,
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


async def _ensure_owner_capacity(db: AsyncSession, user: User) -> None:
    if user.role == "admin":
        return
    # Serialize ownership changes per user so concurrent requests cannot bypass
    # the instance-wide ownership limit.
    await db.execute(select(func.pg_advisory_xact_lock(user.id)))
    owned_count = (
        await db.execute(
            select(func.count(Server.id)).where(Server.owner_id == user.id)
        )
    ).scalar_one()
    if owned_count >= settings.server_owner_limit:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You can own at most {settings.server_owner_limit} servers",
        )


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
    await _ensure_owner_capacity(db, current_user)
    server = Server(
        public_id=generate_public_id("srv"),
        name=payload.name,
        owner_id=current_user.id,
        is_joinable=False,
    )
    db.add(server)
    await db.flush()
    db.add(ServerMember(server_id=server.id, user_id=current_user.id, role="owner"))
    await db.commit()
    await db.refresh(server)
    return _server_response(server, is_member=True, member_count=1)


@router.get("/server-discovery/{public_id}")
async def preview_server(
    public_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = (
        await db.execute(select(Server).where(Server.public_id == public_id))
    ).scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    member = await get_server_member(db, server.id, current_user.id)
    return {
        "public_id": server.public_id,
        "name": server.name,
        "is_member": member is not None,
    }


@router.post(
    "/server-discovery/{public_id}/join-request",
    response_model=ServerJoinRequestResponse,
)
async def request_server_membership(
    public_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    server = (
        await db.execute(select(Server).where(Server.public_id == public_id))
    ).scalar_one_or_none()
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    if await get_server_member(db, server.id, current_user.id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already a server member")
    previous = (
        await db.execute(
            select(ServerJoinRequest)
            .where(
                ServerJoinRequest.server_id == server.id,
                ServerJoinRequest.user_id == current_user.id,
            )
            .order_by(ServerJoinRequest.created_at.desc())
        )
    ).scalars().first()
    if previous and previous.status == "pending":
        request_item = previous
    else:
        if (
            previous
            and previous.status == "rejected"
            and previous.reviewed_at
            and previous.reviewed_at > utcnow() - timedelta(hours=24)
        ):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Try again 24 hours after rejection",
            )
        request_item = ServerJoinRequest(
            server_id=server.id,
            user_id=current_user.id,
            status="pending",
        )
        db.add(request_item)
        await db.commit()
        await db.refresh(request_item)
        if server.owner_id:
            try:
                await get_redis_client().publish(
                    user_events_channel(server.owner_id),
                    json.dumps(
                        {
                            "type": "server_join_request",
                            "server_id": server.id,
                            "server_name": server.name,
                            "display_name": current_user.display_name,
                        },
                        ensure_ascii=False,
                    ),
                )
            except Exception:
                pass
    return ServerJoinRequestResponse(
        id=request_item.id,
        server_id=server.id,
        user_id=current_user.id,
        username=current_user.username,
        display_name=current_user.display_name,
        status=request_item.status,
        created_at=request_item.created_at.isoformat(),
    )


@router.post("/server-invites/{code}/redeem", response_model=ServerResponse)
async def redeem_server_invite(
    code: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invite = (
        await db.execute(
            select(ServerInvite).where(ServerInvite.code == code).with_for_update()
        )
    ).scalar_one_or_none()
    if (
        not invite
        or invite.revoked
        or invite.expires_at < utcnow()
        or invite.current_uses >= invite.max_uses
    ):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite not found or expired")
    server = await db.get(Server, invite.server_id)
    if not server:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    member = await get_server_member(db, server.id, current_user.id)
    if not member:
        db.add(ServerMember(server_id=server.id, user_id=current_user.id, role="member"))
        invite.current_uses += 1
        await db.commit()
    return _server_response(server, is_member=True)


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
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Server not found")
    return _server_response(server, is_member=True)


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
    server.is_joinable = False
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
    new_owner_user = await db.get(User, payload.new_owner_id)
    if not new_owner_user or not new_owner_user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New owner is unavailable")
    await _ensure_owner_capacity(db, new_owner_user)
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


@router.post(
    "/servers/{server_id}/invites",
    response_model=ServerInviteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_server_invite(
    server_id: int,
    payload: ServerInviteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_server_owner(db, server_id, current_user)
    invite = ServerInvite(
        code=f"srv-{generate_public_id('invite')}",
        server_id=server_id,
        created_by=current_user.id,
        expires_at=utcnow() + timedelta(hours=payload.expires_in_hours),
        max_uses=payload.max_uses,
        current_uses=0,
        revoked=False,
    )
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return ServerInviteResponse(
        code=invite.code,
        server_id=invite.server_id,
        expires_at=invite.expires_at.isoformat(),
        max_uses=invite.max_uses,
        current_uses=invite.current_uses,
        revoked=invite.revoked,
    )


@router.get(
    "/servers/{server_id}/join-requests",
    response_model=list[ServerJoinRequestResponse],
)
async def list_server_join_requests(
    server_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_server_owner(db, server_id, current_user)
    rows = (
        await db.execute(
            select(ServerJoinRequest, User)
            .join(User, User.id == ServerJoinRequest.user_id)
            .where(
                ServerJoinRequest.server_id == server_id,
                ServerJoinRequest.status == "pending",
            )
            .order_by(ServerJoinRequest.created_at.asc())
        )
    ).all()
    return [
        ServerJoinRequestResponse(
            id=item.id,
            server_id=item.server_id,
            user_id=user.id,
            username=user.username,
            display_name=user.display_name,
            status=item.status,
            created_at=item.created_at.isoformat(),
        )
        for item, user in rows
    ]


@router.post(
    "/servers/{server_id}/join-requests/{request_id}/review",
    response_model=ServerJoinRequestResponse,
)
async def review_server_join_request(
    server_id: int,
    request_id: int,
    payload: JoinRequestReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _require_server_owner(db, server_id, current_user)
    item = (
        await db.execute(
            select(ServerJoinRequest)
            .where(
                ServerJoinRequest.id == request_id,
                ServerJoinRequest.server_id == server_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Join request not found")
    if item.status == "pending":
        item.status = "approved" if payload.approved else "rejected"
        item.reviewed_by = current_user.id
        item.reviewed_at = utcnow()
        if payload.approved and not await get_server_member(db, server_id, item.user_id):
            db.add(ServerMember(server_id=server_id, user_id=item.user_id, role="member"))
        await db.commit()
        await db.refresh(item)
        try:
            server = await db.get(Server, server_id)
            await get_redis_client().publish(
                user_events_channel(item.user_id),
                json.dumps(
                    {
                        "type": "server_join_reviewed",
                        "server_id": server_id,
                        "server_name": server.name if server else "Borotalk",
                        "approved": payload.approved,
                    },
                    ensure_ascii=False,
                ),
            )
        except Exception:
            pass
    user = await db.get(User, item.user_id)
    return ServerJoinRequestResponse(
        id=item.id,
        server_id=item.server_id,
        user_id=item.user_id,
        username=user.username if user else "unknown",
        display_name=user.display_name if user else "Unknown user",
        status=item.status,
        created_at=item.created_at.isoformat(),
    )


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
            public_id=user.public_id,
            username=user.username,
            display_name=user.display_name,
            avatar_url=user.avatar_url,
            role=member.role,
            is_online=user.is_online,
            joined_at=member.joined_at.isoformat(),
        )
        for member, user in result.all()
    ]


@router.get("/users/{public_id}", response_model=UserProfileResponse)
async def find_user_by_id(
    public_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    user = (
        await db.execute(select(User).where(User.public_id == public_id))
    ).scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserProfileResponse(
        id=user.id,
        public_id=user.public_id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat(),
    )
