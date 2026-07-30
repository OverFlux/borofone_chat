"""
Pydantic схемы для аутентификации.

Используются для валидации request/response в auth endpoints.
"""
from pydantic import BaseModel, ConfigDict, EmailStr, field_validator


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
    invite_code: str | None = None
    website: str = ""

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
    def validate_invite_code(cls, v: str | None) -> str | None:
        """Валидация инвайт-кода."""
        if v is None:
            return None
        v = v.strip()
        return v or None


# === LOGIN ===

class LoginRequest(BaseModel):
    """Схема для логина (email + password)."""
    email: EmailStr
    password: str


class TokenRequest(BaseModel):
    token: str


class EmailRequest(BaseModel):
    email: EmailStr


class PasswordResetRequest(BaseModel):
    token: str
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if len(value) < 8 or len(value) > 128:
            raise ValueError("password must contain 8-128 characters")
        return value


class RegistrationResponse(BaseModel):
    message: str
    status: str


# === USER INFO ===

class UserResponse(BaseModel):
    """
    Схема ответа с информацией о пользователе.

    Используется в GET /auth/me и других endpoints.
    """
    id: int
    public_id: str | None = None
    email: str
    username: str
    display_name: str
    avatar_url: str | None
    role: str
    is_active: bool
    email_verified: bool = False
    created_at: str  # ISO 8601

    model_config = ConfigDict(from_attributes=True)


class UserProfileResponse(BaseModel):
    """
    Схема ответа с публичной информацией о профиле пользователя.
    
    Используется в GET /auth/users/{user_id}.
    """
    id: int
    public_id: str | None = None
    username: str
    display_name: str
    avatar_url: str | None
    role: str
    is_active: bool
    created_at: str  # ISO 8601

    model_config = ConfigDict(from_attributes=True)


# === INVITE MANAGEMENT ===

class InviteCreateRequest(BaseModel):
    """
    Схема для создания инвайт-кода (только админы).

    Все поля опциональны.
    """
    max_uses: int | None = 1
    expires_in_hours: int | None = 72

    @field_validator("max_uses")
    @classmethod
    def validate_max_uses(cls, v: int | None) -> int | None:
        """Валидация max_uses."""
        if v not in (None, 1):
            raise ValueError("global invites are single-use")
        return 1

    @field_validator("expires_in_hours")
    @classmethod
    def validate_expires_in_hours(cls, v: int | None) -> int | None:
        """Валидация expires_in_hours."""
        if v is None:
            return 72
        if v < 1 or v > 72:
            raise ValueError("expires_in_hours must be between 1 and 72")
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

    model_config = ConfigDict(from_attributes=True)

class MessageResponse(BaseModel):
    message: str
