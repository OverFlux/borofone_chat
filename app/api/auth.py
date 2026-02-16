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

from fastapi import APIRouter, Depends, HTTPException, status, Response, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import get_db
from app.models import Invite, User
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    MessageResponse,
    UserResponse,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.dependencies import get_current_user

router = APIRouter(prefix="/auth", tags=["Authentication"])

AVATAR_UPLOAD_DIR = Path("uploads/avatars")
ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_AVATAR_BYTES = 3 * 1024 * 1024

# Cookie settings
ACCESS_TOKEN_EXPIRE_MINUTES = 60
REFRESH_TOKEN_EXPIRE_DAYS = 7

# for prod & https Secure=True
COOKIE_SECURE = False
COOKIE_SAMESITE = "lax" # or "strict"

def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    # Access token
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60, # seconds
    )

    # Refresh token
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60, # second too
)

def clear_auth_cookies(response: Response):
    """Удаление токенов из куки"""
    response.delete_cookie(key="access_token")
    response.delete_cookie(key="refresh_token")

@router.post("/register", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
async def register(
    data: RegisterRequest,
    response: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Регистрация нового пользователя по инвайт-коду.

    После успешной регистрации токены устанавливаются в httpOnly cookies.

    Returns:
        {"message": "Registration successful"}
    """

    # === 1. Проверка инвайт-кода ===
    stmt = select(Invite).where(Invite.code == data.invite_code)
    result = await db.execute(stmt)
    invite = result.scalar_one_or_none()

    if not invite:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid invite code"
        )

    # Проверка: не отозван ли
    if invite.revoked:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite code has been revoked"
        )

    # Проверка: не истёк ли
    if invite.expires_at and invite.expires_at < datetime.now(timezone.utc):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite code has expired"
        )

    # Проверка: не исчерпан ли лимит использований
    if invite.max_uses and invite.current_uses >= invite.max_uses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite code has reached maximum uses"
        )

    # === 2. Проверка уникальности email ===
    stmt = select(User).where(User.email == data.email)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered"
        )

    # === 3. Проверка уникальности username ===
    stmt = select(User).where(User.username == data.username)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username already taken"
        )

    # === 4. Создание пользователя ===
    user = User(
        email=data.email,
        password_hash=hash_password(data.password),
        username=data.username,
        display_name=data.display_name,
        role="member"
    )

    db.add(user)
    await db.flush()  # Чтобы получить user.id

    # === 5. Увеличение счётчика инвайта ===
    invite.current_uses += 1

    await db.commit()
    await db.refresh(user)

    # === 6. Токены в cookies ===
    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})

    set_auth_cookies(response, access_token, refresh_token)

    return {"message": "Registration successful"}


@router.post("/login")
async def login(
    data: LoginRequest,
    responce: Response,
    db: AsyncSession = Depends(get_db)
):
    """
    Вход по email и паролю.

    Токены устанавливаются в httpOnly cookies.

    Returns:
        {"message": "Login successful"}
    """

    # Поиск пользователя по email
    stmt = select(User).where(User.email == data.email)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    # Проверка существования и пароля
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
    access_token = create_access_token({"sub": str(user.id)})
    refresh_token = create_refresh_token({"sub": str(user.id)})

    set_auth_cookies(responce, access_token, refresh_token)

    return {"message": "Login successful"}

@router.post("/refresh")
async def refresh(
    response: Response,
    refresh_token: str = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Обновление access токена через refresh токен из cookie.

    Автоматически читает refresh_token из httpOnly cookie.

    Returns:
        {"message": "Token refreshed"}
    """

    # В реальности refresh_token будет получен из cookie через dependency
    # Для совместимости пока оставляем поддержку body
    from fastapi import Request

    # TODO: Получить refresh_token из cookie
    # request.cookies.get('refresh_token')

    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token not provided"
        )

    try:
        # Декодирование и проверка токена
        payload = decode_token(refresh_token)

        # Проверка типа токена
        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type"
            )

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

        # Проверка существования пользователя
        user = await db.get(User, int(user_id))
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or disabled"
            )

        # Генерация новых токенов
        new_access_token = create_access_token({"sub": user.id})
        new_refresh_token = create_refresh_token({"sub": user.id})

        set_auth_cookies(response, new_access_token, new_refresh_token)

        return {"message": "Token refreshed"}

    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )


@router.post("/logout")
async def logout(response: Response):
    """
    Выход из системы.

    Удаляет токены из cookies.

    Returns:
        {"message": "Logged out successfully"}
    """
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
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at.isoformat()
    )

@router.put("/profile", response_model=UserResponse)
async def update_profile(
    display_name: str = Form(...),
    username: str = Form(...),
    remove_avatar: bool = Form(False),
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
        avatar_url = f"/uploads/avatars/{filename}"

    current_user.display_name = normalized_display_name
    current_user.username = normalized_username
    current_user.avatar_url = avatar_url

    await db.commit()
    await db.refresh(current_user)

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        display_name=current_user.display_name,
        avatar_url=current_user.avatar_url,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at.isoformat()
    )