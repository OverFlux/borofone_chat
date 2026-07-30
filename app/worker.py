"""Reliable delivery worker for email and Telegram notifications."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import delete, select, update

from app.infra.db import SessionLocal, engine
from app.models import NotificationOutbox, RegistrationRequest, TelegramAdminBinding
from app.services.delivery import send_email, telegram_call, telegram_review_keyboard
from app.services.platform import utcnow
from app.settings import settings


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("borotalk.worker")


async def deliver(item: NotificationOutbox, db) -> None:
    if item.kind == "email":
        await send_email(item.recipient, item.payload)
        return
    if item.kind == "telegram_application":
        binding = (
            await db.execute(
                select(TelegramAdminBinding).where(
                    TelegramAdminBinding.telegram_chat_id.is_not(None)
                )
            )
        ).scalars().first()
        if not binding or not binding.telegram_chat_id:
            raise RuntimeError("Telegram admin is not paired")
        payload = item.payload
        await telegram_call(
            "sendMessage",
            {
                "chat_id": binding.telegram_chat_id,
                "text": (
                    "Новая заявка в Borotalk\n\n"
                    f"Имя: {payload['display_name']}\n"
                    f"Ник: @{payload['username']}\n"
                    f"Email: {payload['email']}\n"
                    f"ID: {payload['request_id']}"
                ),
                "reply_markup": telegram_review_keyboard(payload["request_id"]),
            },
        )
        return
    raise RuntimeError(f"Unknown outbox kind: {item.kind}")


async def run_once() -> bool:
    async with SessionLocal() as db:
        await db.execute(
            update(RegistrationRequest)
            .where(
                RegistrationRequest.status.in_(["awaiting_email", "awaiting_approval"]),
                RegistrationRequest.expires_at < utcnow(),
            )
            .values(status="expired")
        )
        await db.execute(
            delete(RegistrationRequest).where(
                RegistrationRequest.status.in_(["approved", "rejected", "expired"]),
                RegistrationRequest.updated_at
                < utcnow() - timedelta(days=settings.registration_retention_days),
            )
        )
        await db.commit()
        item = (
            await db.execute(
                select(NotificationOutbox)
                .where(
                    NotificationOutbox.sent_at.is_(None),
                    NotificationOutbox.available_at <= utcnow(),
                )
                .order_by(NotificationOutbox.id.asc())
                .with_for_update(skip_locked=True)
                .limit(1)
            )
        ).scalar_one_or_none()
        if not item:
            return False
        try:
            await deliver(item, db)
            item.sent_at = utcnow()
            item.last_error = None
        except Exception as exc:
            item.attempts += 1
            delay = min(3600, 30 * (2 ** min(item.attempts, 7)))
            item.available_at = utcnow() + timedelta(seconds=delay)
            item.last_error = str(exc)[:2000]
            logger.warning("Delivery %s failed: %s", item.id, exc)
        await db.commit()
        return True


async def main() -> None:
    try:
        while True:
            worked = await run_once()
            if not worked:
                await asyncio.sleep(5)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
