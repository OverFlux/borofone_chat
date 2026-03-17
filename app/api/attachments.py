"""
Attachments API - загрузка и управление вложениями.
"""
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.dependencies import get_current_user
from app.models import User
from app.settings import settings

router = APIRouter(prefix="/attachments", tags=["Attachments"])

# Директория для хранения файлов
UPLOADS_DIR = settings.attachments_path
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Максимальный размер файла (10MB)
MAX_FILE_SIZE = settings.max_upload_file_size

# Разрешённые MIME типы
ALLOWED_MIME_TYPES = {
    # Images
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
    # Videos
    "video/mp4", "video/webm", "video/ogg",
    # Audio
    "audio/mpeg", "audio/wav", "audio/ogg",
    # Documents
    "application/pdf",
    "application/msword",  # .doc
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "text/plain",
    # Archives
    "application/zip",
    "application/x-rar-compressed",
    "application/x-7z-compressed",
}


@router.post("/upload")
async def upload_attachments(
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    Загрузка файлов (до 10 файлов за раз, макс 10MB каждый).
    
    Returns:
        List[dict]: Список загруженных файлов с metadata
        
    Example response:
        [
            {
                "filename": "photo.jpg",
                "file_path": "/uploads/attachments/abc123.jpg",
                "file_size": 524288,
                "mime_type": "image/jpeg"
            }
        ]
    """
    if len(files) > 10:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum 10 files per upload",
        )
    
    uploaded = []
    
    for file in files:
        # Проверка MIME типа
        if file.content_type not in ALLOWED_MIME_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File type {file.content_type} not allowed",
            )
        
        # Читаем файл
        content = await file.read()
        
        # Проверка размера
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File {file.filename} exceeds 10MB limit",
            )
        
        # Генерируем уникальное имя файла
        ext = Path(file.filename).suffix  # .jpg, .pdf, etc.
        unique_filename = f"{uuid.uuid4().hex}{ext}"
        file_path = UPLOADS_DIR / unique_filename
        
        # Сохраняем файл
        with open(file_path, "wb") as f:
            f.write(content)
        
        # Формируем URL для доступа
        public_url = f"{settings.attachments_public_path}/{unique_filename}"
        
        uploaded.append({
            "filename": file.filename,
            "file_path": public_url,
            "file_size": len(content),
            "mime_type": file.content_type,
        })
    
    return uploaded


@router.delete("/{filename}")
async def delete_attachment(
    filename: str,
    current_user: User = Depends(get_current_user),
):
    """
    Удалить файл (только для админов или владельца сообщения).
    
    TODO: Добавить проверку владения через message_id
    """
    file_path = UPLOADS_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="File not found",
        )
    
    # TODO: Проверка прав доступа
    # if current_user.role != "admin":
    #     check ownership via attachments table
    
    os.remove(file_path)
    
    return {"deleted": filename}

