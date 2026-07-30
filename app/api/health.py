"""Operational health endpoints for VPS monitoring."""

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import require_admin
from app.infra.db import get_db
from app.infra.redis import check_redis_health
from app.models import NotificationOutbox, User


router = APIRouter(tags=["Health"])


@router.get("/healthz", include_in_schema=False)
async def healthz(response: Response, db: AsyncSession = Depends(get_db)):
    database_ok = True
    try:
        await db.execute(text("SELECT 1"))
    except Exception:
        database_ok = False
    redis_ok = await check_redis_health()
    if not database_ok or not redis_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if database_ok and redis_ok else "unavailable",
        "database": database_ok,
        "redis": redis_ok,
    }


@router.get("/api/admin/health")
async def admin_health(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    pending_outbox = (
        await db.execute(
            select(func.count(NotificationOutbox.id)).where(
                NotificationOutbox.sent_at.is_(None)
            )
        )
    ).scalar_one()
    failed_outbox = (
        await db.execute(
            select(func.count(NotificationOutbox.id)).where(
                NotificationOutbox.sent_at.is_(None),
                NotificationOutbox.attempts > 0,
            )
        )
    ).scalar_one()
    return {
        "status": "ok",
        "redis": await check_redis_health(),
        "outbox_pending": pending_outbox,
        "outbox_failed": failed_outbox,
    }
