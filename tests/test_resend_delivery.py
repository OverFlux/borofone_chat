import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from resend.exceptions import ResendError

from app import worker
from app.services import delivery
from app.settings import settings


def _payload() -> dict:
    return {
        "subject": "Borotalk test",
        "text": "Plain text",
        "html": "<p>HTML</p>",
    }


def test_resend_uses_async_sdk_and_stable_idempotency_key(monkeypatch):
    captured = {}

    async def fake_send(params, options=None):
        captured["params"] = params
        captured["options"] = options
        return {"id": "email_123"}

    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "email_provider", "resend")
    monkeypatch.setattr(settings, "resend_api_key", "re_test_only")
    monkeypatch.setattr(settings, "email_from_email", "noreply@mail.example.test")
    monkeypatch.setattr(settings, "email_from_name", "Borotalk")
    monkeypatch.setattr(delivery.resend.Emails, "send_async", fake_send)

    result = asyncio.run(
        delivery.send_email(
            "friend@example.test",
            _payload(),
            idempotency_key="borotalk-outbox/42",
        )
    )

    assert result == {"id": "email_123"}
    assert captured["params"]["from"] == "Borotalk <noreply@mail.example.test>"
    assert captured["params"]["to"] == ["friend@example.test"]
    assert captured["params"]["text"] == "Plain text"
    assert captured["params"]["html"] == "<p>HTML</p>"
    assert captured["options"] == {"idempotency_key": "borotalk-outbox/42"}


def test_resend_requires_a_key_and_rejects_test_sender_in_production(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "email_provider", "resend")
    monkeypatch.setattr(settings, "resend_api_key", "")
    monkeypatch.setattr(settings, "allow_resend_test_sender", False)
    monkeypatch.setattr(settings, "email_from_email", "noreply@mail.example.test")

    with pytest.raises(delivery.PermanentDeliveryError, match="API key"):
        asyncio.run(delivery.send_email("friend@example.test", _payload()))

    monkeypatch.setattr(settings, "resend_api_key", "re_test_only")
    monkeypatch.setattr(settings, "email_from_email", "onboarding@resend.dev")
    with pytest.raises(delivery.PermanentDeliveryError, match="test sender"):
        asyncio.run(delivery.send_email("friend@example.test", _payload()))

    monkeypatch.setattr(settings, "allow_resend_test_sender", True)
    fake_send = AsyncMock(return_value={"id": "email_123"})
    monkeypatch.setattr(delivery.resend.Emails, "send_async", fake_send)
    assert asyncio.run(delivery.send_email("friend@example.test", _payload())) == {
        "id": "email_123"
    }


def test_resend_classifies_permanent_and_retryable_errors():
    invalid_sender = ResendError(
        code=422,
        error_type="validation_error",
        message="Invalid from address",
        suggested_action="Verify the domain",
    )
    rate_limit = ResendError(
        code=429,
        error_type="rate_limit_exceeded",
        message="Try later",
        suggested_action="Retry",
    )
    concurrent = ResendError(
        code=409,
        error_type="concurrent_idempotent_requests",
        message="Request in progress",
        suggested_action="Retry",
    )

    assert delivery._resend_error_is_permanent(invalid_sender) is True
    assert delivery._resend_error_is_permanent(rate_limit) is False
    assert delivery._resend_error_is_permanent(concurrent) is False


def test_smtp_fallback_is_preserved(monkeypatch):
    captured = {}

    def fake_smtp_send(recipient, payload, idempotency_key=None):
        captured.update(
            recipient=recipient,
            payload=payload,
            idempotency_key=idempotency_key,
        )

    monkeypatch.setattr(settings, "email_provider", "smtp")
    monkeypatch.setattr(delivery, "_smtp_send", fake_smtp_send)
    asyncio.run(
        delivery.send_email(
            "friend@example.test",
            _payload(),
            idempotency_key="borotalk-outbox/7",
        )
    )

    assert captured["recipient"] == "friend@example.test"
    assert captured["idempotency_key"] == "borotalk-outbox/7"


def test_worker_passes_outbox_id_as_idempotency_key(monkeypatch):
    captured = {}

    async def fake_send(recipient, payload, idempotency_key=None):
        captured.update(
            recipient=recipient,
            payload=payload,
            idempotency_key=idempotency_key,
        )

    monkeypatch.setattr(worker, "send_email", fake_send)
    item = SimpleNamespace(
        id=91,
        kind="email",
        recipient="friend@example.test",
        payload=_payload(),
    )
    asyncio.run(worker.deliver(item, None))

    assert captured["idempotency_key"] == "borotalk-outbox/91"
