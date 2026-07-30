import asyncio
import base64
import hashlib
import hmac
from types import SimpleNamespace

from fastapi.testclient import TestClient
from starlette.requests import Request

from app.api.webrtc import ice_config
from app.main import app
from app.models import User
from app.schemas.auth import RegisterRequest
from app.security import generate_public_id, hash_token
from app.services import auth_rate_limit
from app.services import platform
from app.settings import settings


def test_registration_accepts_an_optional_invite_and_honeypot():
    request = RegisterRequest(
        email="new@example.com",
        username="new_user",
        display_name="New user",
        password="correct horse battery staple",
    )
    assert request.invite_code is None
    assert request.website == ""


def test_public_ids_and_action_token_hashes_are_non_sequential():
    first = generate_public_id("usr")
    second = generate_public_id("usr")
    assert first.startswith("usr_")
    assert first != second
    assert len(hash_token("secret")) == 64
    assert hash_token("secret") != hash_token("other")


def test_turn_credentials_match_coturn_rest_secret(monkeypatch):
    monkeypatch.setattr(settings, "turn_host", "turn.example.test")
    monkeypatch.setattr(settings, "turn_shared_secret", "shared-secret")
    monkeypatch.setattr(settings, "turn_credential_ttl_seconds", 3600)
    user = User(
        id=7,
        public_id="usr_0123456789abcdef",
        email="voice@example.com",
        password_hash="hash",
        username="voice_user",
        display_name="Voice user",
        role="member",
        is_active=True,
    )
    response = asyncio.run(ice_config(user))
    turn = response.iceServers[1]
    expected = base64.b64encode(
        hmac.new(
            b"shared-secret",
            turn["username"].encode("utf-8"),
            hashlib.sha1,
        ).digest()
    ).decode("ascii")
    assert turn["credential"] == expected
    assert response.iceTransportPolicy == "all"
    assert any(url.startswith("turn:turn.example.test") for url in turn["urls"])


def test_vps_pages_and_public_routes_are_registered():
    with TestClient(app) as client:
        assert client.get("/verify-email.html").status_code == 200
        assert client.get("/forgot-password.html").status_code == 200
        assert client.get("/reset-password.html").status_code == 200
    paths = {route.path for route in app.routes}
    assert "/healthz" in paths
    assert "/api/integrations/telegram/webhook" in paths
    assert "/api/webrtc/ice-config" in paths
    assert "/api/admin/registration-requests" in paths
    assert "/auth/registration/status" in paths
    assert "/server-discovery/{public_id}/join-request" in paths


def test_auth_rate_limit_uses_ip_and_hashed_identity_keys(monkeypatch):
    class FakeRedis:
        def __init__(self):
            self.counts = {}

        async def incr(self, key):
            self.counts[key] = self.counts.get(key, 0) + 1
            return self.counts[key]

        async def expire(self, _key, _seconds):
            return True

    redis = FakeRedis()
    monkeypatch.setattr(auth_rate_limit, "get_redis_client", lambda: redis)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/auth/login",
            "headers": [],
            "client": ("203.0.113.5", 4321),
        }
    )
    asyncio.run(
        auth_rate_limit.enforce_auth_limit(
            request,
            "login",
            limit=10,
            window_seconds=60,
            identifier="Private.Email@example.com",
        )
    )
    assert len(redis.counts) == 2
    assert all("private.email" not in key.lower() for key in redis.counts)
    assert any(":ip:" in key for key in redis.counts)
    assert any(":identity:" in key for key in redis.counts)


def test_production_mutation_requires_exact_origin(monkeypatch):
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "allowed_origins", "https://talk.example.test")
    with TestClient(app) as client:
        response = client.post(
            "/auth/register",
            json={
                "email": "bot@example.test",
                "password": "not-a-real-password",
                "username": "honeypot_user",
                "display_name": "Bot",
                "website": "filled-by-bot",
            },
        )
    assert response.status_code == 403


def test_telegram_delivery_is_optional_for_the_web_approval_queue(monkeypatch):
    class FakeDB:
        def __init__(self):
            self.items = []

        def add(self, item):
            self.items.append(item)

    registration = SimpleNamespace(
        public_id="reg_0123456789abcdef",
        email="friend@example.com",
        username="friend",
        display_name="Friend",
        created_at=None,
    )
    db = FakeDB()
    monkeypatch.setattr(settings, "telegram_bot_token", "")
    platform.enqueue_telegram_application(db, registration)
    assert db.items == []

    monkeypatch.setattr(settings, "telegram_bot_token", "123:test")
    platform.enqueue_telegram_application(db, registration)
    assert len(db.items) == 1
    assert db.items[0].kind == "telegram_application"


def test_branded_email_is_self_contained_and_has_a_clear_action():
    message = platform.branded_email(
        title="Подтвердите ваш email",
        preview="Один шаг до входа.",
        body_html="<p>Проверьте адрес.</p>",
        cta_label="Подтвердить email",
        cta_url="https://talk.example.test/verify-email.html#token=secret",
    )

    assert "<!doctype html>" in message.lower()
    assert "Borotalk" in message
    assert "#b8f5d6" in message.lower()
    assert "Подтвердить email" in message
    assert "https://talk.example.test/verify-email.html#token=secret" in message
    assert "<img" not in message
