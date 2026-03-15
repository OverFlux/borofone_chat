"""
MongoDB connection and client management.
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from typing import Optional

from app.settings import settings

_mongo_client: Optional[AsyncIOMotorClient] = None
_mongo_db: Optional[AsyncIOMotorDatabase] = None


async def get_mongo_db() -> AsyncIOMotorDatabase:
    """Get MongoDB database instance."""
    global _mongo_client, _mongo_db
    
    if _mongo_client is None:
        _mongo_client = AsyncIOMotorClient(settings.mongo_url)
        _mongo_db = _mongo_client[settings.mongo_db]
    
    return _mongo_db


async def close_mongo():
    """Close MongoDB connection."""
    global _mongo_client, _mongo_db
    
    if _mongo_client:
        _mongo_client.close()
        _mongo_client = None
        _mongo_db = None


# Collection names
COLLECTION_ATTACHMENTS = "attachments"
COLLECTION_UPLOADS = "uploads"
