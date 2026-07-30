"""Delivery adapters used by both the API webhook and the outbox worker."""

from __future__ import annotations

import asyncio
import json
import smtplib
import ssl
from email.message import EmailMessage
from urllib import parse, request

from app.settings import settings


def _smtp_send(recipient: str, payload: dict) -> None:
    if not settings.smtp_host or not settings.smtp_from_email:
        raise RuntimeError("SMTP is not configured")
    message = EmailMessage()
    message["Subject"] = payload["subject"]
    message["From"] = f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
    message["To"] = recipient
    message.set_content(payload.get("text", ""))
    if payload.get("html"):
        message.add_alternative(payload["html"], subtype="html")

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        if settings.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)


async def send_email(recipient: str, payload: dict) -> None:
    await asyncio.to_thread(_smtp_send, recipient, payload)


def _telegram_call(method: str, payload: dict) -> dict:
    if not settings.telegram_bot_token:
        raise RuntimeError("Telegram bot is not configured")
    url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/{method}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=20) as response:
        result = json.loads(response.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError(result.get("description", "Telegram API error"))
    return result


async def telegram_call(method: str, payload: dict) -> dict:
    return await asyncio.to_thread(_telegram_call, method, payload)


def telegram_review_keyboard(request_id: str) -> dict:
    return {
        "inline_keyboard": [[
            {"text": "Одобрить", "callback_data": f"review:approve:{request_id}"},
            {"text": "Отклонить", "callback_data": f"review:reject:{request_id}"},
        ]]
    }


def telegram_confirm_keyboard(action: str, request_id: str) -> dict:
    label = "Подтвердить одобрение" if action == "approve" else "Подтвердить отказ"
    return {
        "inline_keyboard": [
            [{"text": label, "callback_data": f"confirm:{action}:{request_id}"}],
            [{"text": "Отмена", "callback_data": f"cancel:none:{request_id}"}],
        ]
    }
