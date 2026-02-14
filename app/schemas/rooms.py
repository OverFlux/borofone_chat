"""
Pydantic schemes for working with chat rooms.
"""
from pydantic import BaseModel, field_validator

# Scheme for creating a room.
class RoomCreate(BaseModel):

    title: str
    description: str | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        v = v.strip() # Removes spaces from the edges of the title

        # Check: not empty
        if not v:
            raise ValueError("title cannot be empty")

        # Check: not too long
        if len(v) > 100:
            raise ValueError("title must be 100 characters or less")

        # Ban only spaces
        if not v.replace(" ", ""):
            raise ValueError("title cannot contain only spaces")

        return v

# Response scheme when creating/getting a room.
class RoomResponse(BaseModel):

    id: int
    title: str
    description: str | None
    created_at: str # ISO 8601

    class Config:
        from_attributes = True  # For compatibility with SQLAlchemy models


class RoomUpdate(BaseModel):
    """Schema для обновления комнаты."""
    title: str | None = None
    description: str | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str | None) -> str | None:
        """Валидация title."""
        if v is None:
            return None

        v = v.strip()

        if not v:
            raise ValueError("title cannot be empty")
        if len(v) > 100:
            raise ValueError("title must be 100 characters or less")

        return v
