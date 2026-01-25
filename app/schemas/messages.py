from pydantic import BaseModel, field_validator, model_validator


class MessageCreate(BaseModel):
    nonce: str | int | None = None
    enforce_nonce: bool = False

    author: str
    body: str

    @field_validator("nonce")
    @classmethod
    def normalize_nonce(cls, v):
        if v is None:
            return None
        v = str(v)
        if not (1 <= len(v) <= 25):
            raise ValueError("nonce must be 1..25 chars")
        return v

    @model_validator(mode="after")
    def validate_enforce_nonce(self):
        if self.enforce_nonce and self.nonce is None:
            raise ValueError("enforce_nonce=true requires nonce")
        return self
