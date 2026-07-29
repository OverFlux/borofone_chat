import asyncio

from app.infra.redis import redis_key, room_events_channel, room_presence_key
from app.main import app_config_js
from app.settings import settings


def test_redis_keys_are_namespaced():
    prefix = f"borotalk:{settings.runtime_namespace}"

    assert redis_key('nonce', 7, 'abc').startswith(prefix + ':')
    assert room_events_channel(3) == f"{prefix}:room:3:events"
    assert room_presence_key(3) == f"{prefix}:room:3:online"


def test_app_config_exposes_storage_namespace():
    response = asyncio.run(app_config_js())
    body = response.body.decode('utf-8')

    assert 'storageNamespace' in body
    assert settings.runtime_namespace in body
