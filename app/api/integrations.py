"""Inbound integrations. Telegram never owns Borotalk authorization state."""

import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infra.db import get_db
from app.models import RegistrationRequest, TelegramAdminBinding, User
from app.security import hash_token
from app.services.delivery import telegram_call, telegram_confirm_keyboard
from app.services.platform import review_registration, utcnow
from app.settings import settings


router = APIRouter(prefix="/api/integrations", tags=["Integrations"])


async def _answer_callback(callback_id: str, text: str) -> None:
    try:
        await telegram_call("answerCallbackQuery", {"callback_query_id": callback_id, "text": text})
    except Exception:
        pass


@router.post("/telegram/webhook", include_in_schema=False)
async def telegram_webhook(
    request: Request,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    configured = settings.telegram_webhook_secret
    if not configured or not x_telegram_bot_api_secret_token or not hmac.compare_digest(
        configured,
        x_telegram_bot_api_secret_token,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid webhook secret")

    update = await request.json()
    message = update.get("message") or {}
    text = message.get("text", "")
    sender = message.get("from") or {}
    chat = message.get("chat") or {}

    if text.startswith("/start pair_") and sender.get("id") and chat.get("id"):
        if chat.get("type") != "private":
            await telegram_call(
                "sendMessage",
                {"chat_id": chat["id"], "text": "Привязка доступна только в личном чате с ботом."},
            )
            return {"ok": True}
        raw_token = text.split("pair_", 1)[1].split()[0]
        binding = (
            await db.execute(
                select(TelegramAdminBinding)
                .where(TelegramAdminBinding.pair_token_hash == hash_token(raw_token))
                .with_for_update()
            )
        ).scalar_one_or_none()
        if not binding or not binding.pair_expires_at or binding.pair_expires_at < utcnow():
            await telegram_call(
                "sendMessage",
                {"chat_id": chat["id"], "text": "Ссылка привязки устарела. Создайте новую в Borotalk."},
            )
            return {"ok": True}
        binding.telegram_user_id = str(sender["id"])
        binding.telegram_chat_id = str(chat["id"])
        binding.pair_token_hash = None
        binding.pair_expires_at = None
        await db.commit()
        await telegram_call(
            "sendMessage",
            {"chat_id": chat["id"], "text": "Borotalk подключён. Новые заявки будут приходить сюда."},
        )
        return {"ok": True}

    callback = update.get("callback_query") or {}
    if not callback:
        return {"ok": True}
    callback_sender = callback.get("from") or {}
    binding = (
        await db.execute(
            select(TelegramAdminBinding).where(
                TelegramAdminBinding.telegram_user_id == str(callback_sender.get("id", ""))
            )
        )
    ).scalar_one_or_none()
    if not binding:
        await _answer_callback(callback.get("id", ""), "Нет прав для этого действия")
        return {"ok": True}
    admin = await db.get(User, binding.admin_user_id)
    if not admin or not admin.is_active or admin.role != "admin":
        await _answer_callback(callback.get("id", ""), "Администратор Borotalk отключён")
        return {"ok": True}

    parts = str(callback.get("data", "")).split(":", 2)
    if len(parts) != 3:
        await _answer_callback(callback.get("id", ""), "Неизвестная команда")
        return {"ok": True}
    stage, action, request_id = parts
    callback_message = callback.get("message") or {}
    callback_chat = callback_message.get("chat") or {}
    if str(callback_chat.get("id", "")) != str(binding.telegram_chat_id or ""):
        await _answer_callback(callback.get("id", ""), "Команда пришла не из связанного чата")
        return {"ok": True}

    if stage == "cancel":
        await _answer_callback(callback.get("id", ""), "Отменено")
        return {"ok": True}
    if stage == "review" and action in {"approve", "reject"}:
        await telegram_call(
            "sendMessage",
            {
                "chat_id": callback_chat.get("id") or binding.telegram_chat_id,
                "text": (
                    "Подтвердите одобрение заявки"
                    if action == "approve"
                    else "Подтвердите отклонение заявки"
                ),
                "reply_markup": telegram_confirm_keyboard(action, request_id),
            },
        )
        await _answer_callback(callback.get("id", ""), "Нужно подтверждение")
        return {"ok": True}
    if stage != "confirm" or action not in {"approve", "reject"}:
        await _answer_callback(callback.get("id", ""), "Неизвестная команда")
        return {"ok": True}

    registration = (
        await db.execute(
            select(RegistrationRequest)
            .where(RegistrationRequest.public_id == request_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not registration:
        await _answer_callback(callback.get("id", ""), "Заявка не найдена")
        return {"ok": True}
    try:
        reviewed = await review_registration(
            db,
            registration,
            approved=action == "approve",
            reviewer_id=binding.admin_user_id,
        )
    except HTTPException as exc:
        await _answer_callback(callback.get("id", ""), str(exc.detail))
        return {"ok": True}

    await _answer_callback(
        callback.get("id", ""),
        "Аккаунт активирован" if reviewed.status == "approved" else "Заявка отклонена",
    )
    if callback_chat.get("id") and callback_message.get("message_id"):
        try:
            await telegram_call(
                "editMessageReplyMarkup",
                {
                    "chat_id": callback_chat["id"],
                    "message_id": callback_message["message_id"],
                    "reply_markup": {"inline_keyboard": []},
                },
            )
        except Exception:
            pass
    return {"ok": True}
