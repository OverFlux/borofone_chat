"""
Pydantic schemes for working with chat rooms.
"""
from pydantic import BaseModel, field_validator

# Scheme for creating a room.
class RoomCreate(BaseModel):

    title: str

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

    class Config:
        from_attributes = True  # For compatibility with SQLAlchemy models
        json_schema_extra = {
            "example": {
                "id": 1,
                "title": "General Discussion"
            }
        }
