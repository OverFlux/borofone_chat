"""
Admin endpoints для управления инвайтами.

Только для пользователей с ролью admin.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import require_admin
from app.infra.db import get_db
from app.models import Invite, User, Room
from app.schemas.auth import InviteCreateRequest, InviteResponse
from app.security import generate_invite_code

router = APIRouter(prefix="/api/admin/invites", tags=["Admin"])


@router.post("", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
async def create_invite(
    data: InviteCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Создание нового инвайт-кода.

    Только для администраторов.

    Args:
        data: InviteCreateRequest с опциональными max_uses и expires_in_hours
        current_user: Текущий пользователь (admin)

    Returns:
        InviteResponse: Созданный инвайт

    Example:
        ```json
        {
            "max_uses": 5,
            "expires_in_hours": 24
        }
        ```

        Создаст инвайт-код на 5 использований, истекающий через 24 часа.
    """

    # Генерация уникального кода
    code = generate_invite_code()

    # Вычисление даты истечения (UTC timezone-aware)
    expires_at = None
    if data.expires_in_hours:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=data.expires_in_hours)

    # Создание инвайта
    invite = Invite(
        code=code,
        created_by=current_user.id,
        expires_at=expires_at,
        max_uses=data.max_uses,
        current_uses=0,
        revoked=False
    )

    db.add(invite)
    await db.commit()
    await db.refresh(invite)

    return InviteResponse(
        id=invite.id,
        code=invite.code,
        created_by=invite.created_by,
        expires_at=invite.expires_at.isoformat() if invite.expires_at else None,
        max_uses=invite.max_uses,
        current_uses=invite.current_uses,
        revoked=invite.revoked,
        created_at=invite.created_at.isoformat()
    )


@router.get("", response_model=list[InviteResponse])
async def list_invites(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    include_revoked: bool = False
):
    """
    Получение списка всех инвайт-кодов.

    Только для администраторов.

    Args:
        include_revoked: Включить ли отозванные инвайты в список

    Returns:
        List[InviteResponse]: Список инвайтов
    """

    stmt = select(Invite).order_by(Invite.created_at.desc())

    if not include_revoked:
        stmt = stmt.where(Invite.revoked == False)

    result = await db.execute(stmt)
    invites = result.scalars().all()

    return [
        InviteResponse(
            id=inv.id,
            code=inv.code,
            created_by=inv.created_by,
            expires_at=inv.expires_at.isoformat() if inv.expires_at else None,
            max_uses=inv.max_uses,
            current_uses=inv.current_uses,
            revoked=inv.revoked,
            created_at=inv.created_at.isoformat()
        )
        for inv in invites
    ]


@router.get("/{invite_id}", response_model=InviteResponse)
async def get_invite(
    invite_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Получение информации об инвайте по ID.

    Только для администраторов.
    """

    invite = await db.get(Invite, invite_id)

    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found"
        )

    return InviteResponse(
        id=invite.id,
        code=invite.code,
        created_by=invite.created_by,
        expires_at=invite.expires_at.isoformat() if invite.expires_at else None,
        max_uses=invite.max_uses,
        current_uses=invite.current_uses,
        revoked=invite.revoked,
        created_at=invite.created_at.isoformat()
    )


@router.delete("/{invite_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invite(
    invite_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin)
):
    """
    Отзыв (deactivation) инвайт-кода.

    Инвайт не удаляется из БД, а помечается как revoked.
    После отзыва инвайт-код нельзя использовать для регистрации.

    Только для администраторов.
    """

    invite = await db.get(Invite, invite_id)

    if not invite:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invite not found"
        )

    if invite.revoked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite is already revoked"
        )

    invite.revoked = True
    await db.commit()

    return None
