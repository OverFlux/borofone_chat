"""
Common Pydantic schemas for APIs.
"""
from pydantic import BaseModel

# Reply health-check endpoint
class HealthResponse(BaseModel):

    ok: bool
    redis: bool

    class Config:
        json_schema_extra = {
            "example": {
                "ok": True,
                "redis": True
            }
        }

# Standard FastAPI error format.
class ErrorResponse(BaseModel):

    detail: str

    class Config:
        json_schema_extra = {
            "examples": [
                {"detail": "nonce conflict"},
                {"detail": "author cannot be empty"},
                {"detail": "body must be 4096 characters or less"}
            ]
        }

# Error format for WebSocket, in case of validation error or nonce conflict
class WebSocketErrorResponse(BaseModel):

    type: str
    code: str | int
    detail: str | dict

    class Config:
        json_schema_extra = {
            "examples": [
                {
                    "type": "error",
                    "code": "validation_error",
                    "detail": [{"field": "author", "message": "author cannot be empty"}]
                },
                {
                    "type": "error",
                    "code": 409,
                    "detail": "nonce conflict"
                }
            ]
        }
