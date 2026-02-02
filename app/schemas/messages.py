"""
Pydantic schemes for working with chat messages.
"""
from pydantic import BaseModel, field_validator, model_validator

# Схема для создания сообщения.
class MessageCreate(BaseModel):

    author: str
    body: str
    nonce: str | int | None = None
    enforce_nonce: bool = False

    @field_validator("author")
    @classmethod
    def validate_author(cls, v: str) -> str:
        """
        Author name validation.

        Limit: 32 characters
        """
        v = v.strip()

        if not v:
            raise ValueError("author cannot be empty")

        if len(v) > 32:
            raise ValueError("author must be 32 characters or less")

        return v

    @field_validator("body")
    @classmethod
    def validate_body(cls, v: str) -> str:
        """
        Message text validation.

        Limit: 4096 characters.
        The database uses Text (unlimited), but it is validated at the API level.
        """
        v = v.strip()

        if not v:
            raise ValueError("body cannot be empty")

        if len(v) > 4096:
            raise ValueError("body must be 4096 characters or less")

        return v

    @field_validator("nonce")
    @classmethod
    def validate_nonce(cls, v: str | int | None) -> str | None:
        """
        Nonce validation.

        Discord limit: 25 characters.
        Can be a string, a number, or None.
        """
        if v is None:
            return None

        v = str(v)

        if not (1 <= len(v) <= 25):
            raise ValueError("nonce must be 1-25 characters")

        return v

    @model_validator(mode="after")
    def validate_enforce_nonce(self):
        """
        Consistency check: enforce_nonce requires a nonce.

        If enforce_nonce=true but no nonce is specified, an error occurs.
        """
        if self.enforce_nonce and self.nonce is None:
            raise ValueError("enforce_nonce requires nonce to be set")

        return self


class MessageResponse(BaseModel):
    """
    Response schema when creating/receiving a message.

    Used as response_model in endpoints.
    """
    id: int
    room_id: int
    nonce: str | None
    author: str
    body: str
    created_at: str  # ISO 8601 format

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "id": 1,
                "room_id": 1,
                "nonce": "abc123",
                "author": "user123",
                "body": "Hello, world!",
                "created_at": "2025-02-01T22:00:00+00:00"
            }
        }
