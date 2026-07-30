from pydantic import BaseModel, Field, field_validator


class ServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    is_joinable: bool = False

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("server name cannot be empty")
        return value


class ServerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    is_joinable: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("server name cannot be empty")
        return value


class ServerTransferOwner(BaseModel):
    new_owner_id: int = Field(gt=0)


class ServerResponse(BaseModel):
    id: int
    public_id: str | None = None
    name: str
    owner_id: int | None
    is_joinable: bool
    created_at: str
    member_count: int | None = None
    is_member: bool | None = None


class ServerMemberResponse(BaseModel):
    user_id: int
    public_id: str | None = None
    username: str
    display_name: str
    avatar_url: str | None
    role: str
    is_online: bool
    joined_at: str
