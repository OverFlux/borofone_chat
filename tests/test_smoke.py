import pytest


@pytest.mark.asyncio
async def test_health(ac):
    r = await ac.get("/health")
    assert r.status_code == 200
