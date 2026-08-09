"""Administration for closed registration, users and Telegram pairing."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import require_admin
from app.infra.db import get_db
from app.models import (
    NotificationOutbox,
    RegistrationRequest,
    TelegramAdminBinding,
    User,
)
from app.schemas.platform import (
    RegistrationAdminResponse,
    RegistrationReview,
    TelegramPairResponse,
    UserAdminUpdate,
)
from app.security import generate_action_token, hash_token
from app.services.platform import review_registration, utcnow
from app.settings import settings


router = APIRouter(prefix="/api/admin", tags=["Platform admin"])


def registration_response(item: RegistrationRequest) -> RegistrationAdminResponse:
    return RegistrationAdminResponse(
        public_id=item.public_id,
        email=item.email,
        username=item.username,
        display_name=item.display_name,
        status=item.status,
        email_verified=item.email_verified_at is not None,
        created_at=item.created_at.isoformat(),
        expires_at=item.expires_at.isoformat(),
    )


@router.get("/registration-requests", response_model=list[RegistrationAdminResponse])
async def list_registration_requests(
    request_status: str = "awaiting_approval",
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    query = select(RegistrationRequest).order_by(RegistrationRequest.created_at.desc())
    if request_status != "all":
        query = query.where(RegistrationRequest.status == request_status)
    result = await db.execute(query.limit(200))
    return [registration_response(item) for item in result.scalars().all()]


@router.post(
    "/registration-requests/{request_id}/review",
    response_model=RegistrationAdminResponse,
)
async def review_registration_request(
    request_id: str,
    payload: RegistrationReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    registration = (
        await db.execute(
            select(RegistrationRequest)
            .where(RegistrationRequest.public_id == request_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not registration:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Registration not found")
    reviewed = await review_registration(
        db,
        registration,
        approved=payload.approved,
        reviewer_id=current_user.id,
    )
    return registration_response(reviewed)


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    users = (await db.execute(select(User).order_by(User.created_at.desc()).limit(500))).scalars().all()
    return [
        {
            "public_id": user.public_id,
            "email": user.email,
            "username": user.username,
            "display_name": user.display_name,
            "role": user.role,
            "is_active": user.is_active,
            "email_verified": user.email_verified_at is not None,
            "created_at": user.created_at.isoformat(),
        }
        for user in users
    ]


@router.patch("/users/{public_id}")
async def update_user(
    public_id: str,
    payload: UserAdminUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = (
        await db.execute(select(User).where(User.public_id == public_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id and not payload.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Cannot disable your own account")
    user.is_active = payload.is_active
    await db.commit()
    return {"public_id": user.public_id, "is_active": user.is_active}


@router.get("/delivery-failures")
async def delivery_failures(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    items = (
        await db.execute(
            select(NotificationOutbox)
            .where(
                NotificationOutbox.sent_at.is_(None),
                (
                    NotificationOutbox.failed_at.is_not(None)
                    | (NotificationOutbox.attempts > 0)
                ),
            )
            .order_by(NotificationOutbox.created_at.desc())
            .limit(100)
        )
    ).scalars().all()
    return [
        {
            "id": item.id,
            "kind": item.kind,
            "recipient": item.recipient,
            "attempts": item.attempts,
            "available_at": item.available_at.isoformat(),
            "failed_at": item.failed_at.isoformat() if item.failed_at else None,
            "permanent": item.failed_at is not None,
            "last_error": item.last_error,
        }
        for item in items
    ]


@router.post("/telegram/pair", response_model=TelegramPairResponse)
async def create_telegram_pairing(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not settings.telegram_bot_username:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Telegram bot username is not configured",
        )
    existing_binding = (
        await db.execute(select(TelegramAdminBinding).with_for_update())
    ).scalar_one_or_none()
    if existing_binding and existing_binding.admin_user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Telegram is already paired with another administrator",
        )
    raw_token = generate_action_token()
    expires_at = utcnow() + timedelta(minutes=10)
    binding = existing_binding
    if not binding:
        binding = TelegramAdminBinding(singleton_key=True, admin_user_id=current_user.id)
        db.add(binding)
    binding.pair_token_hash = hash_token(raw_token)
    binding.pair_expires_at = expires_at
    await db.commit()
    return TelegramPairResponse(
        url=f"https://t.me/{settings.telegram_bot_username}?start=pair_{raw_token}",
        expires_at=expires_at.isoformat(),
    )


@router.delete("/telegram/pair", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_telegram(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    binding = (
        await db.execute(
            select(TelegramAdminBinding).where(
                TelegramAdminBinding.admin_user_id == current_user.id
            )
        )
    ).scalar_one_or_none()
    if binding:
        binding.telegram_user_id = None
        binding.telegram_chat_id = None
        binding.pair_token_hash = None
        binding.pair_expires_at = None
        await db.commit()
