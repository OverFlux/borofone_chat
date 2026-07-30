from pydantic import BaseModel, Field


class RegistrationReview(BaseModel):
    approved: bool


class RegistrationAdminResponse(BaseModel):
    public_id: str
    email: str
    username: str
    display_name: str
    status: str
    email_verified: bool
    created_at: str
    expires_at: str


class TelegramPairResponse(BaseModel):
    url: str
    expires_at: str


class IceConfigResponse(BaseModel):
    iceServers: list[dict]
    iceTransportPolicy: str = "all"
    expires_at: str | None = None


class ServerInviteCreate(BaseModel):
    max_uses: int = Field(default=1, ge=1, le=25)
    expires_in_hours: int = Field(default=72, ge=1, le=720)


class ServerInviteResponse(BaseModel):
    code: str
    server_id: int
    expires_at: str
    max_uses: int
    current_uses: int
    revoked: bool


class ServerJoinRequestResponse(BaseModel):
    id: int
    server_id: int
    user_id: int
    username: str
    display_name: str
    status: str
    created_at: str


class JoinRequestReview(BaseModel):
    approved: bool


class UserAdminUpdate(BaseModel):
    is_active: bool
