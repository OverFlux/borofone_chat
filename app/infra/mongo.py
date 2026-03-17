"""
MongoDB connection and client management.
"""
import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING

from app.settings import settings

logger = logging.getLogger(__name__)

_mongo_client: Optional[AsyncIOMotorClient] = None
_mongo_db: Optional[AsyncIOMotorDatabase] = None
_mongo_indexes_ready = False


async def _ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    """Create required indexes once per process."""
    global _mongo_indexes_ready

    if _mongo_indexes_ready:
        return

    uploads = db[COLLECTION_UPLOADS]
    await uploads.create_index([("id", ASCENDING)], unique=True, name="uq_upload_id")
    await uploads.create_index([("filename", ASCENDING)], name="idx_upload_filename")
    await uploads.create_index([("message_id", ASCENDING)], name="idx_upload_message_id")
    await uploads.create_index([("room_id", ASCENDING), ("created_at", ASCENDING)], name="idx_upload_room_created_at")
    await uploads.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)], name="idx_upload_user_created_at")
    _mongo_indexes_ready = True


async def get_mongo_db() -> AsyncIOMotorDatabase | None:
    """Get MongoDB database instance if available."""
    global _mongo_client, _mongo_db

    if _mongo_client is None:
        client = AsyncIOMotorClient(
            settings.mongo_url,
            serverSelectionTimeoutMS=3000,
            connectTimeoutMS=3000,
            socketTimeoutMS=5000,
            maxPoolSize=20,
            minPoolSize=1,
            maxIdleTimeMS=30000,
            uuidRepresentation="standard",
            appname="borofone-chat",
        )
        try:
            await client.admin.command("ping")
        except Exception as exc:
            client.close()
            logger.warning("MongoDB unavailable, continuing without metadata storage: %s", exc)
            return None

        _mongo_client = client
        _mongo_db = _mongo_client[settings.mongo_db]
        logger.info("MongoDB client connected to %s/%s", settings.mongo_url, settings.mongo_db)

    if _mongo_db is None:
        return None

    await _ensure_indexes(_mongo_db)
    return _mongo_db


async def close_mongo():
    """Close MongoDB connection."""
    global _mongo_client, _mongo_db, _mongo_indexes_ready

    if _mongo_client:
        _mongo_client.close()
        _mongo_client = None
        _mongo_db = None
        _mongo_indexes_ready = False
        logger.info("MongoDB connections closed")


# Collection names
COLLECTION_ATTACHMENTS = "attachments"
COLLECTION_UPLOADS = "uploads"
