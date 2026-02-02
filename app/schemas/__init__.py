"""
Pydantic schemas for API validation and documentation.
"""

# Common schemas
from app.schemas.common import (
    HealthResponse,
    ErrorResponse,
    WebSocketErrorResponse,
)

# Room schemas
from app.schemas.rooms import (
    RoomCreate,
    RoomResponse,
)

# Message schemas
from app.schemas.messages import (
    MessageCreate,
    MessageResponse,
)

__all__ = [
    # Common
    "HealthResponse",
    "ErrorResponse",
    "WebSocketErrorResponse",
    # Rooms
    "RoomCreate",
    "RoomResponse",
    # Messages
    "MessageCreate",
    "MessageResponse",
]
