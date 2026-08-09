"""Delivery adapters used by both the API webhook and the outbox worker."""

from __future__ import annotations

import asyncio
import json
import smtplib
import ssl
from email.message import EmailMessage
from urllib import parse, request

import resend
from resend.exceptions import ResendError

from app.settings import settings


class PermanentDeliveryError(RuntimeError):
    """A delivery error that retries cannot resolve without configuration changes."""


def _sender() -> str:
    email = settings.resolved_email_from_email
    if not email:
        raise PermanentDeliveryError("Email sender is not configured")
    return f"{settings.resolved_email_from_name} <{email}>"


def _smtp_send(recipient: str, payload: dict, idempotency_key: str | None = None) -> None:
    if not settings.smtp_host:
        raise RuntimeError("SMTP is not configured")
    message = EmailMessage()
    message["Subject"] = payload["subject"]
    message["From"] = _sender()
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


def _resend_error_is_permanent(exc: ResendError) -> bool:
    try:
        status_code = int(exc.code)
    except (TypeError, ValueError):
        status_code = 0
    if status_code == 409 and exc.error_type == "concurrent_idempotent_requests":
        return False
    return status_code in {400, 401, 403, 404, 409, 422}


async def _resend_send(
    recipient: str,
    payload: dict,
    idempotency_key: str | None = None,
) -> dict:
    api_key = settings.resend_api_key.strip()
    if not api_key:
        raise PermanentDeliveryError("Resend API key is not configured")
    sender_email = settings.resolved_email_from_email.lower()
    if (
        settings.app_env.lower() == "production"
        and sender_email.endswith("@resend.dev")
        and not settings.allow_resend_test_sender
    ):
        raise PermanentDeliveryError("The Resend test sender cannot be used in production")

    params: resend.Emails.SendParams = {
        "from": _sender(),
        "to": [recipient],
        "subject": payload["subject"],
    }
    if payload.get("text"):
        params["text"] = payload["text"]
    if payload.get("html"):
        params["html"] = payload["html"]

    options: resend.Emails.SendOptions | None = None
    if idempotency_key:
        options = {"idempotency_key": idempotency_key[:256]}
    resend.api_key = api_key
    try:
        return await resend.Emails.send_async(params, options)
    except ResendError as exc:
        if _resend_error_is_permanent(exc):
            raise PermanentDeliveryError(
                f"Resend rejected the email ({exc.error_type}, HTTP {exc.code}): {exc.message}"
            ) from exc
        raise


async def send_email(
    recipient: str,
    payload: dict,
    idempotency_key: str | None = None,
) -> dict | None:
    provider = settings.email_provider.strip().lower()
    if provider == "resend":
        return await _resend_send(recipient, payload, idempotency_key)
    if provider == "smtp":
        await asyncio.to_thread(_smtp_send, recipient, payload, idempotency_key)
        return None
    raise PermanentDeliveryError(f"Unsupported email provider: {provider or '(empty)'}")


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
