"""
Pydantic схемы для аутентификации.

Используются для валидации request/response в auth endpoints.
"""
from pydantic import BaseModel, EmailStr, field_validator


# === REGISTRATION ===

class RegisterRequest(BaseModel):
    """
    Схема для регистрации нового пользователя.

    Требует инвайт-код для регистрации.
    """
    email: EmailStr
    password: str
    username: str
    display_name: str
    invite_code: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        """Валидация пароля: минимум 8 символов."""
        if len(v) < 8:
            raise ValueError("password must be at least 8 characters")
        if len(v) > 128:
            raise ValueError("password must be 128 characters or less")
        return v

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        """Валидация username: 3-32 символа, только буквы/цифры/underscore."""
        v = v.strip()

        if len(v) < 3:
            raise ValueError("username must be at least 3 characters")
        if len(v) > 32:
            raise ValueError("username must be 32 characters or less")

        # Только буквы, цифры и underscore
        if not v.replace("_", "").isalnum():
            raise ValueError("username can only contain letters, numbers, and underscores")

        return v

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: str) -> str:
        """Валидация display_name: 1-50 символов."""
        v = v.strip()

        if not v:
            raise ValueError("display_name cannot be empty")
        if len(v) > 50:
            raise ValueError("display_name must be 50 characters or less")

        return v

    @field_validator("invite_code")
    @classmethod
    def validate_invite_code(cls, v: str) -> str:
        """Валидация инвайт-кода."""
        v = v.strip()

        if not v:
            raise ValueError("invite_code is required")

        return v


# === LOGIN ===

class LoginRequest(BaseModel):
    """Схема для логина (email + password)."""
    email: EmailStr
    password: str


# class TokenResponse(BaseModel):
#     """
#     Схема ответа с JWT токенами.
#
#     Возвращается при успешной регистрации или логине.
#     """
#     access_token: str
#     refresh_token: str
#     token_type: str = "bearer"


# === REFRESH ===

class RefreshRequest(BaseModel):
    """Схема для обновления access токена через refresh токен."""
    refresh_token: str


# === USER INFO ===

class UserResponse(BaseModel):
    """
    Схема ответа с информацией о пользователе.

    Используется в GET /auth/me и других endpoints.
    """
    id: int
    email: str
    username: str
    display_name: str
    avatar_url: str | None
    role: str
    is_active: bool
    created_at: str  # ISO 8601

    class Config:
        from_attributes = True


class UserProfileResponse(BaseModel):
    """
    Схема ответа с публичной информацией о профиле пользователя.
    
    Используется в GET /auth/users/{user_id}.
    """
    id: int
    username: str
    display_name: str
    avatar_url: str | None
    role: str
    is_active: bool
    created_at: str  # ISO 8601

    class Config:
        from_attributes = True


# === INVITE MANAGEMENT ===

class InviteCreateRequest(BaseModel):
    """
    Схема для создания инвайт-кода (только админы).

    Все поля опциональны.
    """
    max_uses: int | None = None  # None = unlimited
    expires_in_hours: int | None = None  # None = never expires

    @field_validator("max_uses")
    @classmethod
    def validate_max_uses(cls, v: int | None) -> int | None:
        """Валидация max_uses."""
        if v is not None and v < 1:
            raise ValueError("max_uses must be at least 1")
        return v

    @field_validator("expires_in_hours")
    @classmethod
    def validate_expires_in_hours(cls, v: int | None) -> int | None:
        """Валидация expires_in_hours."""
        if v is not None and v < 1:
            raise ValueError("expires_in_hours must be at least 1")
        return v


class InviteResponse(BaseModel):
    """
    Схема ответа с информацией об инвайте.
    """
    id: int
    code: str
    created_by: int | None
    expires_at: str | None  # ISO 8601
    max_uses: int | None
    current_uses: int
    revoked: bool
    created_at: str  # ISO 8601

    class Config:
        from_attributes = True

class MessageResponse(BaseModel):
    message: str