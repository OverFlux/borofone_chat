"""Pydantic schemas for Borotalk text rooms."""

from pydantic import BaseModel, ConfigDict, field_validator


class RoomCreate(BaseModel):
    server_id: int
    title: str
    description: str | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("title cannot be empty")
        if len(value) > 100:
            raise ValueError("title must be 100 characters or less")
        return value


class RoomResponse(BaseModel):
    id: int
    server_id: int
    title: str
    description: str | None
    created_at: str

    model_config = ConfigDict(from_attributes=True)
