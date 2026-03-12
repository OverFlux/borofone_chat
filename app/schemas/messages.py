"""
Pydantic schemes for working with chat messages.
"""
from pydantic import BaseModel, field_validator, model_validator


class MessageUserResponse(BaseModel):
    id: int
    username: str
    display_name: str
    avatar_url: str | None
    role: str = "member"  # Add role field for admin crown display

    class Config:
        from_attributes = True


class MessageCreate(BaseModel):
    body: str = ""
    nonce: str | int | None = None
    enforce_nonce: bool = False
    attachments: list[dict] | None = None
    reply_to_id: int | None = None

    @field_validator("body")
    @classmethod
    def validate_body(cls, v: str) -> str:
        if v is None:
            return ""
        v = v.strip()
        if len(v) > 4096:
            raise ValueError("body must be 4096 characters or less")
        return v

    @model_validator(mode="after")
    def validate_body_or_attachments(self):
        has_body = self.body and self.body.strip()
        has_attachments = self.attachments and len(self.attachments) > 0
        if not has_body and not has_attachments:
            raise ValueError("either body or attachments are required")
        return self

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


class MessageEdit(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def validate_body(cls, v: str) -> str:
        if v is None:
            return ""
        v = v.strip()
        if len(v) > 4096:
            raise ValueError("body must be 4096 characters or less")
        return v


class AttachmentResponse(BaseModel):
    id: int
    message_id: int
    filename: str
    file_path: str
    file_size: int
    mime_type: str | None
    created_at: str

    class Config:
        from_attributes = True


class ReactionCreate(BaseModel):
    emoji: str

    @field_validator("emoji")
    @classmethod
    def validate_emoji(cls, v: str) -> str:
        v = (v or "").strip()
        if not v or len(v) > 16:
            raise ValueError("emoji must be 1-16 characters")
        return v


class ReactionResponse(BaseModel):
    emoji: str
    count: int
    reacted_by_me: bool = False


class MessageReplyPreview(BaseModel):
    id: int
    body: str
    user: MessageUserResponse


class MessageResponse(BaseModel):
    id: int
    room_id: int
    nonce: str | None
    body: str
    created_at: str
    edited_at: str | None
    attachments: list[AttachmentResponse] = []
    reactions: list[ReactionResponse] = []
    reply_to: MessageReplyPreview | None = None
    is_deleted: bool = False
    user: MessageUserResponse

    class Config:
        from_attributes = True


class MessageWithAttachmentsResponse(MessageResponse):
    attachments: list[AttachmentResponse] = []
    mentions: list[MessageUserResponse] = []
