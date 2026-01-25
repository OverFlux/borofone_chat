from pydantic import BaseModel

class MessageCreate(BaseModel):
    author: str
    body: str