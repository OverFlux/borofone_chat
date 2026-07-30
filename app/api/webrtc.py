"""Authenticated, short-lived ICE configuration for the browser and Desktop."""

import base64
import hashlib
import hmac
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.dependencies import get_current_user
from app.models import User
from app.schemas.platform import IceConfigResponse
from app.settings import settings


router = APIRouter(prefix="/api/webrtc", tags=["WebRTC"])


@router.get("/ice-config", response_model=IceConfigResponse)
async def ice_config(current_user: User = Depends(get_current_user)):
    if not settings.turn_host or not settings.turn_shared_secret:
        if settings.app_env.lower() in {"development", "dev", "local"}:
            return IceConfigResponse(
                iceServers=[{"urls": ["stun:stun.l.google.com:19302"]}],
                iceTransportPolicy="all",
            )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="TURN is not configured",
        )

    expires = int(time.time()) + settings.turn_credential_ttl_seconds
    username = f"{expires}:{current_user.public_id or current_user.id}"
    digest = hmac.new(
        settings.turn_shared_secret.encode("utf-8"),
        username.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    credential = base64.b64encode(digest).decode("ascii")
    host = settings.turn_host
    return IceConfigResponse(
        iceServers=[
            {"urls": [f"stun:{host}:{settings.turn_port}"]},
            {
                "urls": [
                    f"turn:{host}:{settings.turn_port}?transport=udp",
                    f"turn:{host}:{settings.turn_port}?transport=tcp",
                    f"turns:{host}:{settings.turn_tls_port}?transport=tcp",
                ],
                "username": username,
                "credential": credential,
            },
        ],
        iceTransportPolicy="all",
        expires_at=datetime.fromtimestamp(expires, tz=timezone.utc).isoformat(),
    )
