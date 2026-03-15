"""
MongoDB connection and client management.
"""
import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.settings import settings

logger = logging.getLogger(__name__)

_mongo_client: Optional[AsyncIOMotorClient] = None
_mongo_db: Optional[AsyncIOMotorDatabase] = None


async def get_mongo_db() -> AsyncIOMotorDatabase:
    """Get MongoDB database instance."""
    global _mongo_client, _mongo_db
    
    if _mongo_client is None:
        # Configure timeouts to prevent long delays
        # serverSelectionTimeoutMS: Time to wait for server selection
        # connectTimeoutMS: Time to wait for connection
        # socketTimeoutMS: Time to wait for socket operations
        _mongo_client = AsyncIOMotorClient(
            settings.mongo_url,
            serverSelectionTimeoutMS=5000,  # 5 seconds - fail fast if MongoDB unavailable
            connectTimeoutMS=5000,           # 5 seconds - connection timeout
            socketTimeoutMS=10000,           # 10 seconds - socket timeout
            maxPoolSize=50,                  # Connection pool size
            minPoolSize=1,                   # Minimum connections
            maxIdleTimeMS=30000,             # Close idle connections after 30s
        )
        _mongo_db = _mongo_client[settings.mongo_db]
        logger.info(f"MongoDB client created: {settings.mongo_url}")
    
    return _mongo_db


async def close_mongo():
    """Close MongoDB connection."""
    global _mongo_client, _mongo_db
    
    if _mongo_client:
        _mongo_client.close()
        _mongo_client = None
        _mongo_db = None
        logger.info("MongoDB connections closed")


# Collection names
COLLECTION_ATTACHMENTS = "attachments"
COLLECTION_UPLOADS = "uploads"
