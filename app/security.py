"""
Утилиты для аутентификации и безопасности.

Содержит:
- Хеширование паролей (bcrypt)
- Создание и проверка JWT токенов
- Генерация инвайт-кодов
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
import bcrypt
from app.settings import settings

# === PASSWORD HASHING ===

def hash_password(password: str) -> str:
    """
    Хеширование пароля с помощью bcrypt.

    Args:
        password: Пароль в открытом виде

    Returns:
        Хеш пароля для хранения в БД
    """
    password_bytes = password.encode("utf-8")
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Проверка пароля против хеша.

    Args:
        plain_password: Пароль в открытом виде
        hashed_password: Хеш из БД

    Returns:
        True если пароль совпадает, False иначе

    """
    password_bytes = plain_password.encode("utf-8")
    hashed_password = hashed_password.encode("utf-8")
    return bcrypt.checkpw(password_bytes, hashed_password)


# === JWT TOKENS ===

# Секретный ключ для подписи JWT (должен быть в .env)
SECRET_KEY = settings.jwt_secret_key
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = settings.access_token_expire_minutes
REFRESH_TOKEN_EXPIRE_DAYS = settings.refresh_token_expire_days


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Создание JWT access токена.

    Args:
        data: Данные для включения в токен (обычно {"sub": user_id})
        expires_delta: Время жизни токена (по умолчанию 30 дней)

    Returns:
        JWT токен строкой

    """
    to_encode = data.copy()

    now_utc = datetime.now(timezone.utc)

    if expires_delta:
        expire = now_utc + expires_delta
    else:
        expire = now_utc + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode.update({
        "exp": expire,
        "iat": now_utc,
        "type": "access"})

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def create_refresh_token(data: dict, *, jti: str | None = None) -> str:
    """
    Создание JWT refresh токена (более долгий TTL).

    Args:
        data: Данные для включения в токен

    Returns:
        JWT refresh токен
    """
    to_encode = data.copy()

    now_utc = datetime.now(timezone.utc)
    expire = now_utc + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({
        "exp": expire,
        "iat": now_utc,
        "jti": jti or secrets.token_urlsafe(24),
        "type": "refresh"})

    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def decode_token(token: str) -> dict:
    """
    Декодирование и проверка JWT токена.

    Args:
        token: JWT токен строкой

    Returns:
        Payload токена (dict)

    Raises:
        JWTError: Если токен невалидный или истёк

    """
    payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    return payload


# === INVITE CODES ===

def generate_invite_code(length: int = 16) -> str:
    """
    Генерация случайного инвайт-кода.

    Args:
        length: Длина кода (по умолчанию 16 символов)

    Returns:
        Случайный код (URL-safe)

    Example:
        'aB3xK9mN2pQr7vWz'
    """
    # Используем secrets для криптографически стойкой генерации
    return f"boro-{secrets.token_hex(8)}"


def generate_public_id(prefix: str) -> str:
    """Generate a non-sequential identifier suitable for copy/paste and URLs."""
    return f"{prefix}_{secrets.token_hex(8)}"


def generate_action_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


# === TOKEN VALIDATION ===

def get_user_id_from_token(token: str) -> Optional[int]:
    """
    Извлечение user_id из JWT токена.

    Args:
        token: JWT токен

    Returns:
        user_id или None если токен невалидный
    """
    try:
        payload = decode_token(token)
        user_id: str = payload.get("sub")

        if user_id is None:
            return None

        return int(user_id)
    except (JWTError, ValueError):
        return None
