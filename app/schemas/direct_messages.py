from pydantic import BaseModel, Field, field_validator


class DirectConversationResponse(BaseModel):
    id: int
    peer_id: int
    peer_username: str
    peer_display_name: str
    peer_avatar_url: str | None
    created_at: str


class DirectMessageCreate(BaseModel):
    body: str = Field(min_length=1, max_length=2000)
    nonce: str | None = Field(default=None, max_length=25)

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("message body cannot be empty")
        return value


class DirectMessageResponse(BaseModel):
    id: int
    conversation_id: int
    sender_id: int | None
    body: str
    nonce: str | None
    created_at: str
    deleted_at: str | None
