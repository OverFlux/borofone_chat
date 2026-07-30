"""
Authentication endpoints.

Содержит:
- POST /auth/register - регистрация по инвайт-коду
- POST /auth/login - вход по email/password
- POST /auth/refresh - обновление access токена
- GET /auth/me - получение информации о текущем пользователе
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import secrets

from fastapi import APIRouter, Depends, HTTPException, status, Response, UploadFile, File, Form, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import get_db
from app.models import (
    PasswordResetToken,
    RefreshSession,
    RegistrationRequest,
    Room,
    Server,
    ServerMember,
    User,
    UserEmailVerificationToken,
    VoiceRoom,
)
from app.settings import settings
from app.schemas.auth import (
    LoginRequest,
    RegisterRequest,
    EmailRequest,
    PasswordResetRequest,
    RegistrationResponse,
    TokenRequest,
    UserResponse,
    UserProfileResponse,
)
from app.security import (
    create_access_token,
    decode_token,
    generate_action_token,
    generate_public_id,
    hash_password,
    hash_token,
    verify_password,
)
from app.dependencies import get_current_user
from app.services.auth_rate_limit import enforce_auth_limit
from app.services.platform import (
    RegistrationEmailUnavailable,
    branded_email,
    create_registration,
    create_session_tokens,
    enqueue_email,
    public_url,
    utcnow,
    verify_registration_email,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

AVATAR_UPLOAD_DIR = settings.avatars_path
ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_AVATAR_BYTES = settings.max_avatar_bytes
BUILT_IN_AVATAR_PRESETS = {
    "duck-ioi",
    "duck-neon",
    "duck-sunset",
    "duck-chainsaw",
    "duck-proximity",
    "duck-pale",
    "duck-purple",
    "duck-dragon",
    "duck-concussion-collector",
    "duck-classic",
    "duck-remote",
    "duck-british",
    "duck-concussion",
    "duck-devil",
    "duck-remote-mk2",
    "duck-proximity-mk2",
}
LEGACY_AVATAR_PRESETS = {
    "mint-star",
    "violet-orbit",
    "peach-wave",
    "mint-dot",
    "violet-arrow",
    "peach-b",
}

# Cookie settings
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes
REFRESH_TOKEN_EXPIRE_DAYS = settings.refresh_token_expire_days

# for prod & https Secure=True
COOKIE_SECURE = settings.cookie_secure
COOKIE_SAMESITE = settings.cookie_samesite

def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    # Access token
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",  # Важно: cookie доступна для всех путей
    )

    # Refresh token
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60, # seconds
        path="/",  # Важно: cookie доступна для всех путей
)

def clear_auth_cookies(response: Response):
    """Удаление токенов из куки"""
    response.delete_cookie(key="access_token", path="/")
    response.delete_cookie(key="refresh_token", path="/")

@router.post("/register", response_model=RegistrationResponse, status_code=status.HTTP_202_ACCEPTED)
async def register(
    data: RegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    if data.website:
        return {"message": "Check your email to continue", "status": "awaiting_email"}
    await enforce_auth_limit(
        request,
        "register",
        limit=5,
        window_seconds=3600,
        identifier=str(data.email),
    )
    try:
        registration = await create_registration(
            db,
            email=str(data.email),
            username=data.username,
            display_name=data.display_name,
            password=data.password,
            invite_code=data.invite_code,
        )
    except RegistrationEmailUnavailable:
        await db.rollback()
        return {
            "message": "Check your email to continue",
            "status": "awaiting_email",
        }
    return {
        "message": "Check your email to continue",
        "status": registration.status,
    }


@router.post("/email/verify")
async def verify_email(
    data: TokenRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await enforce_auth_limit(request, "verify-email", limit=20, window_seconds=3600)
    now = utcnow()
    existing_token = (
        await db.execute(
            select(UserEmailVerificationToken)
            .where(UserEmailVerificationToken.token_hash == hash_token(data.token))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if existing_token:
        if existing_token.used_at is not None or existing_token.expires_at < now:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
        user = await db.get(User, existing_token.user_id)
        if not user or not user.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
        user.email_verified_at = now
        existing_token.used_at = now
        await db.commit()
        return {"message": "Email confirmed", "status": "approved"}
    registration = await verify_registration_email(db, data.token)
    return {
        "message": (
            "Account activated"
            if registration.status == "approved"
            else "Email confirmed. Registration is awaiting approval"
        ),
        "status": registration.status,
    }


@router.post("/email/request-verification")
async def request_existing_email_verification(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.email_verified_at is not None:
        return {"message": "Email is already verified"}
    await enforce_auth_limit(
        request,
        "verify-existing-email-short",
        limit=1,
        window_seconds=60,
        identifier=current_user.email,
    )
    await enforce_auth_limit(
        request,
        "verify-existing-email",
        limit=5,
        window_seconds=86400,
        identifier=current_user.email,
    )
    raw_token = generate_action_token()
    await db.execute(
        update(UserEmailVerificationToken)
        .where(
            UserEmailVerificationToken.user_id == current_user.id,
            UserEmailVerificationToken.used_at.is_(None),
        )
        .values(used_at=utcnow())
    )
    db.add(
        UserEmailVerificationToken(
            user_id=current_user.id,
            token_hash=hash_token(raw_token),
            expires_at=utcnow() + timedelta(hours=24),
        )
    )
    url = public_url(f"verify-email.html#token={raw_token}")
    enqueue_email(
        db,
        current_user.email,
        "Подтвердите email — Borotalk",
        f"Подтвердите существующий аккаунт Borotalk: {url}\nСсылка действует 24 часа.",
        branded_email(
            title="Подтвердите ваш email",
            preview="Защитите существующий аккаунт Borotalk.",
            body_html=(
                "<p style=\"margin:0 0 22px\">Подтвердите адрес, чтобы восстановление пароля "
                "и важные уведомления работали надёжно.</p>"
                "<p style=\"margin:0 0 20px;color:#7a8079;font-size:13px\">Ссылка действует 24 часа.</p>"
            ),
            cta_label="Подтвердить email",
            cta_url=url,
        ),
    )
    await db.commit()
    return {"message": "Verification email queued"}


@router.post("/email/resend")
async def resend_verification(
    data: EmailRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    normalized_email = str(data.email).lower()
    await enforce_auth_limit(
        request,
        "resend-email-short",
        limit=1,
        window_seconds=60,
        identifier=normalized_email,
    )
    await enforce_auth_limit(
        request,
        "resend-email",
        limit=5,
        window_seconds=86400,
        identifier=normalized_email,
    )
    registration = (
        await db.execute(
            select(RegistrationRequest)
            .where(
                RegistrationRequest.email == normalized_email,
                RegistrationRequest.status == "awaiting_email",
            )
            .order_by(RegistrationRequest.created_at.desc())
        )
    ).scalars().first()
    if registration:
        raw_token = generate_action_token()
        registration.email_token_hash = hash_token(raw_token)
        registration.email_token_expires_at = utcnow() + timedelta(hours=24)
        from app.services.platform import verification_email

        verification_email(db, registration, raw_token)
        await db.commit()
    return {"message": "If a pending registration exists, a new email has been queued"}


@router.post("/password/forgot")
async def forgot_password(
    data: EmailRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    normalized_email = str(data.email).lower()
    await enforce_auth_limit(
        request,
        "forgot-password",
        limit=5,
        window_seconds=3600,
        identifier=normalized_email,
    )
    user = (
        await db.execute(
            select(User).where(User.email == normalized_email, User.is_active.is_(True))
        )
    ).scalar_one_or_none()
    if user:
        raw_token = generate_action_token()
        await db.execute(
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=utcnow())
        )
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(raw_token),
                expires_at=utcnow() + timedelta(minutes=30),
            )
        )
        url = public_url(f"reset-password.html#token={raw_token}")
        enqueue_email(
            db,
            user.email,
            "Сброс пароля — Borotalk",
            f"Откройте страницу сброса пароля: {url}\nСсылка действует 30 минут.",
            branded_email(
                title="Сбросить пароль",
                preview="Ссылка для восстановления доступа к Borotalk.",
                body_html=(
                    "<p style=\"margin:0 0 22px\">Мы получили запрос на смену пароля. "
                    "Нажмите кнопку ниже, чтобы придумать новый.</p>"
                    "<p style=\"margin:0 0 20px;color:#7a8079;font-size:13px\">Ссылка действует 30 минут.</p>"
                ),
                cta_label="Сменить пароль",
                cta_url=url,
            ),
        )
        await db.commit()
    return {"message": "If the account exists, a password reset email has been queued"}


@router.post("/password/reset")
async def reset_password(
    data: PasswordResetRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await enforce_auth_limit(request, "reset-password", limit=10, window_seconds=3600)
    now = utcnow()
    reset_token = (
        await db.execute(
            select(PasswordResetToken)
            .where(PasswordResetToken.token_hash == hash_token(data.token))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if (
        not reset_token
        or reset_token.used_at is not None
        or reset_token.expires_at < now
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
    user = await db.get(User, reset_token.user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired token")
    user.password_hash = hash_password(data.password)
    await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    sessions = (
        await db.execute(
            select(RefreshSession).where(
                RefreshSession.user_id == user.id,
                RefreshSession.revoked_at.is_(None),
            )
        )
    ).scalars().all()
    for session in sessions:
        session.revoked_at = now
    await db.commit()
    return {"message": "Password updated. Sign in again."}


@router.post("/registration/status", response_model=RegistrationResponse)
async def registration_status(
    data: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await enforce_auth_limit(
        request,
        "registration-status",
        limit=10,
        window_seconds=900,
        identifier=str(data.email),
    )
    normalized_email = str(data.email).lower()
    registration = (
        await db.execute(
            select(RegistrationRequest)
            .where(RegistrationRequest.email == normalized_email)
            .order_by(RegistrationRequest.created_at.desc())
        )
    ).scalars().first()
    if not registration or not verify_password(data.password, registration.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )
    return {
        "message": "Registration status is available",
        "status": registration.status,
    }


@router.post("/login")
async def login(
    data: LoginRequest,
    responce: Response,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Вход по email и паролю.

    Токены устанавливаются в httpOnly cookies.

    Returns:
        {"message": "Login successful"}
    """

    await enforce_auth_limit(
        request,
        "login",
        limit=10,
        window_seconds=900,
        identifier=str(data.email),
    )
    normalized_email = str(data.email).lower()
    stmt = select(User).where(User.email == normalized_email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    # Проверка существования и пароля
    if not user:
        pending = (
            await db.execute(
                select(RegistrationRequest)
                .where(RegistrationRequest.email == normalized_email)
                .order_by(RegistrationRequest.created_at.desc())
            )
        ).scalars().first()
        if pending and verify_password(data.password, pending.password_hash):
            details = {
                "awaiting_email": "Confirm your email before signing in",
                "awaiting_approval": "Registration request is awaiting approval",
                "rejected": "Registration request was rejected",
                "expired": "Registration request expired",
            }
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=details.get(pending.status, "Account is not active"),
            )
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )

    # Проверка активности аккаунта
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled"
        )

    # Установка токенов в cookies
    access_token, refresh_token, session = create_session_tokens(user.id)
    db.add(session)
    await db.commit()
    set_auth_cookies(responce, access_token, refresh_token)

    return {"message": "Login successful"}


@router.post("/demo")
async def demo_login(
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Create or reuse a local demo user and issue a normal cookie session."""
    if settings.app_env.lower() not in {"development", "dev", "local"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

    demo_email = "demo@borotalk.local"
    demo_username = "borotalk_demo"

    result = await db.execute(select(User).where(User.email == demo_email))
    user = result.scalar_one_or_none()

    if user is None:
        username_result = await db.execute(select(User).where(User.username == demo_username))
        if username_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Reserved demo username is already in use",
            )

        user = User(
            public_id=generate_public_id("usr"),
            email=demo_email,
            password_hash=hash_password(secrets.token_urlsafe(32)),
            username=demo_username,
            display_name="Demo User",
            role="member",
            is_active=True,
            email_verified_at=utcnow(),
        )
        db.add(user)
        await db.flush()
        await db.commit()
        await db.refresh(user)
    elif not user.is_active:
        user.is_active = True
        await db.commit()

    server = (
        await db.execute(
            select(Server).where(
                Server.owner_id == user.id,
                Server.name == "Boro friends",
            )
        )
    ).scalar_one_or_none()
    if server is None:
        server = Server(
            public_id=generate_public_id("srv"),
            name="Boro friends",
            owner_id=user.id,
            is_joinable=False,
        )
        db.add(server)
        await db.flush()

    membership = (
        await db.execute(
            select(ServerMember).where(
                ServerMember.server_id == server.id,
                ServerMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if membership is None:
        db.add(ServerMember(server_id=server.id, user_id=user.id, role="owner"))

    text_room = (
        await db.execute(
            select(Room).where(Room.server_id == server.id, Room.title == "общий")
        )
    ).scalar_one_or_none()
    if text_room is None:
        db.add(Room(server_id=server.id, title="общий", created_by=user.id))

    existing_voice_names = set(
        (
            await db.execute(
                select(VoiceRoom.name).where(
                    VoiceRoom.server_id == server.id,
                    VoiceRoom.is_active.is_(True),
                )
            )
        ).scalars().all()
    )
    for room_name in ("Кухня", "Ночной разговор", "Не отвлекать"):
        if room_name not in existing_voice_names:
            db.add(
                VoiceRoom(
                    server_id=server.id,
                    name=room_name,
                    created_by=user.id,
                    is_active=True,
                )
            )
    await db.commit()

    access_token, refresh_token, session = create_session_tokens(user.id)
    db.add(session)
    await db.commit()
    set_auth_cookies(response, access_token, refresh_token)

    return {
        "message": "Demo login successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "display_name": user.display_name,
        },
        "server_id": server.id,
    }


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Обновление access токена через refresh токен из cookie.

    Автоматически читает refresh_token из httpOnly cookie.

    Returns:
        {"message": "Token refreshed"}
    """

    # Получаем refresh_token из cookie
    refresh_token = request.cookies.get('refresh_token')

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token not provided"
        )

    try:
        payload = decode_token(refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError("invalid token type")
        user_id = int(payload["sub"])
        user = await db.get(User, user_id)
        if not user or not user.is_active:
            raise ValueError("inactive user")

        now = utcnow()
        jti = payload.get("jti")
        if not jti:
            raise ValueError("untracked refresh token")
        old_session = (
            await db.execute(
                select(RefreshSession)
                .where(RefreshSession.jti == jti)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if (
            not old_session
            or old_session.user_id != user.id
            or old_session.revoked_at is not None
            or old_session.expires_at < now
            or old_session.token_hash != hash_token(refresh_token)
        ):
            active_sessions = (
                await db.execute(
                    select(RefreshSession).where(
                        RefreshSession.user_id == user.id,
                        RefreshSession.revoked_at.is_(None),
                    )
                )
            ).scalars().all()
            for active in active_sessions:
                active.revoked_at = now
            await db.commit()
            raise ValueError("refresh token reuse")

        new_access_token, new_refresh_token, new_session = create_session_tokens(user.id)
        db.add(new_session)
        await db.flush()
        old_session.revoked_at = now
        old_session.replaced_by_jti = new_session.jti
        await db.commit()
        set_auth_cookies(response, new_access_token, new_refresh_token)
        return {"message": "Token refreshed"}
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Выход из системы.

    Удаляет токены из cookies.

    Returns:
        {"message": "Logged out successfully"}
    """
    refresh_token = request.cookies.get("refresh_token")
    if refresh_token:
        try:
            payload = decode_token(refresh_token)
            jti = payload.get("jti")
            if jti:
                session = (
                    await db.execute(select(RefreshSession).where(RefreshSession.jti == jti))
                ).scalar_one_or_none()
                if session and session.revoked_at is None:
                    session.revoked_at = utcnow()
                    await db.commit()
        except Exception:
            await db.rollback()
    clear_auth_cookies(response)
    return {"message": "Logged out successfully"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """
    Получение информации о текущем авторизованном пользователе.

    Токен автоматически читается из httpOnly cookie.
    """
    return UserResponse(
        id=current_user.id,
        public_id=current_user.public_id,
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        role=current_user.role,
        is_active=current_user.is_active,
        email_verified=current_user.email_verified_at is not None,
        created_at=current_user.created_at.isoformat()
    )


@router.get("/users/{user_id}", response_model=UserProfileResponse)
async def get_user_profile(
    user_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Получение публичного профиля пользователя по ID.
    
    Возвращает публичную информацию: имя, аватар, username, дату регистрации.
    """
    if user_id != current_user.id:
        my_server_ids = select(ServerMember.server_id).where(
            ServerMember.user_id == current_user.id
        )
        shared = (
            await db.execute(
                select(ServerMember.id).where(
                    ServerMember.user_id == user_id,
                    ServerMember.server_id.in_(my_server_ids),
                )
            )
        ).scalar_one_or_none()
        if shared is None:
            raise HTTPException(status_code=404, detail="User not found")
    stmt = select(User).where(User.id == user_id, User.is_active.is_(True))
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return UserProfileResponse(
        id=user.id,
        public_id=user.public_id,
        username=user.username,
        display_name=user.display_name,
        avatar_url=user.avatar_url,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at.isoformat()
    )


@router.put("/profile", response_model=UserResponse)
async def update_profile(
    display_name: str = Form(...),
    username: str = Form(...),
    remove_avatar: bool = Form(False),
    avatar_preset: str | None = Form(None),
    avatar: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Обновление настроек пользователя и аватарки."""
    normalized_display_name = display_name.strip()
    normalized_username = username.strip()

    if not normalized_display_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="display_name cannot be empty")
    if len(normalized_display_name) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="display_name must be 50 characters or less")

    if len(normalized_username) < 3:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username must be at least 3 characters")
    if len(normalized_username) > 32:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="username must be 32 characters or less")
    if not normalized_username.replace("_", "").isalnum():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="username can only contain letters, numbers, and underscores"
        )

    stmt = select(User).where(User.username == normalized_username, User.id != current_user.id)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")

    avatar_url = current_user.avatar_url
    if remove_avatar:
        avatar_url = None

    if avatar_preset:
        allowed_presets = BUILT_IN_AVATAR_PRESETS | LEGACY_AVATAR_PRESETS
        if avatar_preset not in allowed_presets:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown avatar preset")
        avatar_url = f"preset:{avatar_preset}"

    if avatar:
        ext = Path(avatar.filename or "").suffix.lower()
        if ext not in ALLOWED_AVATAR_EXTENSIONS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported avatar format")

        data = await avatar.read()
        if len(data) > MAX_AVATAR_BYTES:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Avatar is too large")

        AVATAR_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"{current_user.id}_{secrets.token_hex(8)}{ext}"
        avatar_path = AVATAR_UPLOAD_DIR / filename
        avatar_path.write_bytes(data)
        avatar_url = f"{settings.avatar_public_path}/{filename}"

    current_user.display_name = normalized_display_name
    current_user.username = normalized_username
    current_user.avatar_url = avatar_url

    await db.commit()
    await db.refresh(current_user)

    return UserResponse(
        id=current_user.id,
        public_id=current_user.public_id,
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        role=current_user.role,
        is_active=current_user.is_active,
        email_verified=current_user.email_verified_at is not None,
        created_at=current_user.created_at.isoformat()
    )
