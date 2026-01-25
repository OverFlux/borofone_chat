from pydantic import BaseModel
from uuid import UUID

class MessageCreate(BaseModel):
    client_msg_id: UUID
    author: str
    body: str
