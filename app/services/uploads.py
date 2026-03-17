"""
Upload service - manages file uploads metadata in MongoDB.
"""
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import UploadFile
from pydantic import BaseModel

from app.infra.mongo import get_mongo_db, COLLECTION_UPLOADS
from app.settings import settings


class UploadMetadata(BaseModel):
    """Metadata for an uploaded file stored in MongoDB."""
    id: str
    filename: str
    original_filename: str
    file_path: str
    file_size: int
    mime_type: Optional[str]
    message_id: Optional[int]
    room_id: Optional[int]
    user_id: int
    created_at: datetime
    # Lazy loading support - only load actual file when requested
    thumbnail_path: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    duration: Optional[float] = None  # For video/audio


class UploadService:
    """Service for handling file uploads with MongoDB metadata."""
    
    def __init__(self):
        self.uploads_dir = settings.attachments_path
        self.uploads_dir.mkdir(parents=True, exist_ok=True)

    async def save_metadata(
        self,
        *,
        filename: str,
        original_filename: Optional[str],
        file_path: str,
        file_size: int,
        mime_type: Optional[str],
        user_id: int,
        message_id: Optional[int] = None,
        room_id: Optional[int] = None,
    ) -> UploadMetadata | None:
        """Persist upload metadata in MongoDB when it is available."""
        db = await get_mongo_db()
        if db is None:
            return None

        metadata = UploadMetadata(
            id=str(uuid.uuid4()),
            filename=filename,
            original_filename=original_filename or filename,
            file_path=file_path,
            file_size=file_size,
            mime_type=mime_type,
            message_id=message_id,
            room_id=room_id,
            user_id=user_id,
            created_at=datetime.now(timezone.utc),
        )

        await db[COLLECTION_UPLOADS].insert_one(metadata.model_dump())
        return metadata

    async def save_file(self, file: UploadFile, user_id: int, message_id: Optional[int] = None, room_id: Optional[int] = None) -> UploadMetadata:
        """Save a file and create metadata in MongoDB when available."""
        # Generate unique filename
        ext = Path(file.filename).suffix if file.filename else ''
        unique_filename = f"{uuid.uuid4().hex}{ext}"
        file_path = self.uploads_dir / unique_filename
        
        # Read file content
        content = await file.read()
        
        # Save file to disk
        with open(file_path, "wb") as f:
            f.write(content)
        
        public_path = f"{settings.attachments_public_path}/{unique_filename}"
        metadata = await self.save_metadata(
            filename=unique_filename,
            original_filename=file.filename or 'unknown',
            file_path=public_path,
            file_size=len(content),
            mime_type=file.content_type,
            user_id=user_id,
            message_id=message_id,
            room_id=room_id,
        )

        if metadata is not None:
            return metadata

        return UploadMetadata(
            id=str(uuid.uuid4()),
            filename=unique_filename,
            original_filename=file.filename or 'unknown',
            file_path=public_path,
            file_size=len(content),
            mime_type=file.content_type,
            message_id=message_id,
            room_id=room_id,
            user_id=user_id,
            created_at=datetime.now(timezone.utc),
        )
    
    async def get_by_message(self, message_id: int) -> list[UploadMetadata]:
        """Get all uploads for a message."""
        db = await get_mongo_db()
        if db is None:
            return []
        cursor = db[COLLECTION_UPLOADS].find({"message_id": message_id})
        results = []
        async for doc in cursor:
            doc.pop("_id", None)
            results.append(UploadMetadata(**doc))
        return results
    
    async def delete(self, upload_id: str) -> bool:
        """Delete an upload and its file."""
        db = await get_mongo_db()
        if db is None:
            return False
        
        # Get upload metadata
        doc = await db[COLLECTION_UPLOADS].find_one({"id": upload_id})
        if not doc:
            return False
        
        # Delete file from disk
        filename = doc.get("filename")
        if filename:
            file_path = self.uploads_dir / filename
            if file_path.exists():
                file_path.unlink()
        
        # Delete from MongoDB
        await db[COLLECTION_UPLOADS].delete_one({"id": upload_id})
        return True

    async def delete_metadata_by_filename(self, filename: str) -> bool:
        """Delete MongoDB metadata for a file without touching the file itself."""
        db = await get_mongo_db()
        if db is None:
            return False

        result = await db[COLLECTION_UPLOADS].delete_one({"filename": filename})
        return result.deleted_count > 0
    
    async def get_recent_uploads(self, room_id: int, limit: int = 50, before_id: Optional[str] = None) -> list[UploadMetadata]:
        """Get recent uploads for a room (for lazy loading)."""
        db = await get_mongo_db()
        if db is None:
            return []
        
        query = {"room_id": room_id}
        if before_id:
            # Get upload before this ID (for pagination)
            before_doc = await db[COLLECTION_UPLOADS].find_one({"id": before_id})
            if before_doc:
                query["created_at"] = {"$lt": before_doc["created_at"]}
        
        cursor = db[COLLECTION_UPLOADS].find(query).sort("created_at", -1).limit(limit)
        results = []
        async for doc in cursor:
            doc.pop("_id", None)
            results.append(UploadMetadata(**doc))
        return results


upload_service = UploadService()
