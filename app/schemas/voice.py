from pydantic import BaseModel, Field


class VoiceRoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class VoiceRoomResponse(BaseModel):
    id: int
    name: str
    created_by: int | None
    created_at: str
    is_active: bool
