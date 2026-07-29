"""Pydantic schemas for Borotalk text-channel messages."""
from pydantic import BaseModel, ConfigDict, field_validator, model_validator


class MessageUserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    avatar_url: str | None
    role: str = "member"

    model_config = ConfigDict(from_attributes=True)


class MessageCreate(BaseModel):
    body: str
    nonce: str | int | None = None
    enforce_nonce: bool = False

    @field_validator("body")
    @classmethod
    def validate_body(cls, v: str) -> str:
        value = (v or "").strip()
        if not value:
            raise ValueError("body is required")
        if len(value) > 2000:
            raise ValueError("body must be 2000 characters or less")
        return value

    @field_validator("nonce")
    @classmethod
    def validate_nonce(cls, v: str | int | None) -> str | None:
        if v is None:
            return None

        v_str = str(v).strip()

        if len(v_str) > 25:
            raise ValueError("nonce must be 1-25 characters")

        return v_str if v_str else None

    @model_validator(mode="after")
    def validate_enforce_nonce(self):
        if self.enforce_nonce and not self.nonce:
            raise ValueError("enforce_nonce requires nonce to be set")
        return self


class MessageResponse(BaseModel):
    id: int
    room_id: int
    nonce: str | None
    body: str
    created_at: str
    user: MessageUserResponse

    model_config = ConfigDict(from_attributes=True)
