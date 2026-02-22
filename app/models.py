"""
SQLAlchemy модели для приложения.

Содержит:
- User: пользователи с аутентификацией
- Invite: инвайт-коды для регистрации
- Room: комнаты чата
- Message: сообщения (теперь с привязкой к User)
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Базовый класс для всех моделей."""
    pass


class User(Base):
    """
    Модель пользователя.

    Поля:
    - email: уникальный email для входа
    - password_hash: bcrypt хеш пароля
    - username: уникальный username (отображается в чате)
    - display_name: отображаемое имя (можно менять)
    - avatar_url: ссылка на аватар (опционально)
    - role: роль (admin, moderator, member)
    - is_active: активен ли аккаунт (для бана)
    - created_at: дата регистрации
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Аутентификация
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)

    # Профиль
    username: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(50), nullable=False)
    avatar_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)

    # Права и статус
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="member"  # admin, moderator, member
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Метаданные
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="user",
        cascade="all, delete-orphan"
    )


class Invite(Base):
    """
    Модель инвайт-кода для регистрации.

    Инвайты создаются администраторами и позволяют
    новым пользователям зарегистрироваться.

    Поля:
    - code: уникальный код (например: "abc123xyz")
    - created_by: кто создал инвайт
    - expires_at: когда истекает (опционально)
    - max_uses: максимум использований (NULL = бесконечно)
    - current_uses: сколько раз использовали
    - revoked: отозван ли инвайт
    """
    __tablename__ = "invites"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)

    # Кто создал инвайт (может быть NULL если админ удалён)
    created_by: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    # Ограничения
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    max_uses: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # NULL = unlimited
    current_uses: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Статус
    revoked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Метаданные
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class Room(Base):
    """
    Модель комнаты чата.

    Изменения: добавлено поле created_by.
    """
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(100), nullable=False)  # уменьшили с 200 до 100
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Кто создал комнату (опционально)
    created_by: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="room",
        cascade="all, delete-orphan"
    )


class Message(Base):
    """
    Модель сообщения.

    Изменения:
    - Заменили author (str) на user_id (FK к User)
    - Добавили relationship к User и Room
    - Добавили поля edited_at и deleted_at
    """
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # Discord-like nonce для дедупликации
    nonce: Mapped[Optional[str]] = mapped_column(String(25), nullable=True)

    # Связи
    room_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("rooms.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),  # SET NULL чтобы сообщения остались
        nullable=True,  # nullable на случай удаления юзера
        index=True
    )
    reply_to_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Содержимое
    body: Mapped[str] = mapped_column(Text, nullable=False)

    # Метаданные
    edited_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    user: Mapped[Optional["User"]] = relationship("User", back_populates="messages")
    room: Mapped["Room"] = relationship("Room", back_populates="messages")
    attachments: Mapped[list["Attachment"]] = relationship(
        "Attachment",
        back_populates="message",
        cascade="all, delete-orphan"
    )
    reactions: Mapped[list["MessageReaction"]] = relationship(
        "MessageReaction",
        back_populates="message",
        cascade="all, delete-orphan"
    )
    reply_to: Mapped[Optional["Message"]] = relationship(
        "Message",
        remote_side="Message.id",
        foreign_keys=[reply_to_id],
    )

    # Индексы для быстрого поиска
    # CREATE INDEX idx_messages_user_nonce ON messages(user_id, nonce);
    # Создадим в миграции

class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(127), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    message: Mapped["Message"] = relationship(
        "Message",
        back_populates="attachments"
    )


class MessageReaction(Base):
    __tablename__ = "message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_user_emoji"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    emoji: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    message: Mapped["Message"] = relationship("Message", back_populates="reactions")
    user: Mapped["User"] = relationship("User")
