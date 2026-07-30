"""Shared services for VPS onboarding, notifications and rotating sessions."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html import escape

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Invite,
    NotificationOutbox,
    RefreshSession,
    RegistrationRequest,
    User,
)
from app.security import (
    create_access_token,
    create_refresh_token,
    generate_action_token,
    generate_public_id,
    hash_password,
    hash_token,
)
from app.settings import settings


ACTIVE_REGISTRATION_STATES = {"awaiting_email", "awaiting_approval"}


class RegistrationEmailUnavailable(Exception):
    """Internal signal used to avoid disclosing whether an email exists."""


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def public_url(path: str) -> str:
    base = (settings.public_base_url or f"http://{settings.app_host}:{settings.app_port}").rstrip("/")
    return f"{base}/{path.lstrip('/')}"


def enqueue_email(db: AsyncSession, recipient: str, subject: str, text: str, html: str = "") -> None:
    db.add(
        NotificationOutbox(
            kind="email",
            recipient=recipient,
            payload={"subject": subject, "text": text, "html": html},
        )
    )


def branded_email(
    *,
    title: str,
    preview: str,
    body_html: str,
    cta_label: str | None = None,
    cta_url: str | None = None,
    note: str = "Если вы не запрашивали это письмо, просто проигнорируйте его.",
) -> str:
    """Build a self-contained email that renders well in conservative mail clients."""
    safe_title = escape(title)
    safe_preview = escape(preview)
    safe_note = escape(note)
    action = ""
    if cta_label and cta_url:
        action = (
            '<tr><td style="padding:8px 0 28px">'
            f'<a href="{escape(cta_url, quote=True)}" '
            'style="display:inline-block;padding:14px 22px;border-radius:14px;'
            'background:#b8f5d6;color:#10251b;font-size:15px;font-weight:750;'
            'text-decoration:none"> '
            f'{escape(cta_label)}</a></td></tr>'
        )
    return f"""<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eeeeea;color:#20231f;font-family:Inter,Arial,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">{safe_preview}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eeeeea">
<tr><td align="center" style="padding:32px 14px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"
 style="max-width:600px;border:1px solid #d4d7d1;border-radius:24px;background:#ffffff;overflow:hidden">
<tr><td style="padding:26px 32px;border-bottom:1px solid #e2e4df;background:#f7f8f5">
<table role="presentation" cellspacing="0" cellpadding="0"><tr>
<td style="width:42px;height:42px;border-radius:13px;background:#b8f5d6;color:#10251b;
 text-align:center;font-size:20px;font-weight:800;vertical-align:middle">B</td>
<td style="padding-left:12px;color:#20231f;font-size:16px;font-weight:750">Borotalk</td>
</tr></table></td></tr>
<tr><td style="padding:34px 32px 10px">
<div style="margin-bottom:10px;color:#6b716b;font-size:10px;font-weight:700;letter-spacing:.14em;
 text-transform:uppercase">Голосовые комнаты</div>
<h1 style="margin:0 0 16px;color:#20231f;font-size:30px;line-height:1.08;letter-spacing:-.035em">
{safe_title}</h1>
</td></tr>
<tr><td style="padding:0 32px;color:#555c55;font-size:15px;line-height:1.65">{body_html}</td></tr>
<tr><td style="padding:0 32px"><table role="presentation" cellspacing="0" cellpadding="0">{action}</table></td></tr>
<tr><td style="padding:20px 32px 28px;border-top:1px solid #e2e4df;color:#7a8079;
 font-size:12px;line-height:1.55">{safe_note}<br><span style="color:#a0a59f">Borotalk · Зашёл. Услышал своих.</span></td></tr>
</table>
</td></tr></table>
</body></html>"""


def enqueue_telegram_application(db: AsyncSession, registration: RegistrationRequest) -> None:
    if not settings.telegram_bot_token:
        return
    db.add(
        NotificationOutbox(
            kind="telegram_application",
            recipient="admin",
            payload={
                "request_id": registration.public_id,
                "email": registration.email,
                "username": registration.username,
                "display_name": registration.display_name,
                "created_at": registration.created_at.isoformat() if registration.created_at else utcnow().isoformat(),
            },
        )
    )


def verification_email(db: AsyncSession, registration: RegistrationRequest, raw_token: str) -> None:
    url = public_url(f"verify-email.html#token={raw_token}")
    display_name = escape(registration.display_name)
    enqueue_email(
        db,
        registration.email,
        "Подтвердите email — Borotalk",
        (
            f"Здравствуйте, {registration.display_name}!\n\n"
            f"Подтвердите email, чтобы продолжить регистрацию в Borotalk: {url}\n\n"
            "Ссылка действует 24 часа."
        ),
        branded_email(
            title="Подтвердите ваш email",
            preview="Один шаг до входа в Borotalk.",
            body_html=(
                f"<p style=\"margin:0 0 16px\">Здравствуйте, <strong>{display_name}</strong>!</p>"
                "<p style=\"margin:0 0 22px\">Остался один шаг. После подтверждения инвайт "
                "активирует аккаунт сразу, а регистрация без кода отправится владельцу на одобрение.</p>"
                "<p style=\"margin:0 0 20px;color:#7a8079;font-size:13px\">Ссылка действует 24 часа.</p>"
            ),
            cta_label="Подтвердить email",
            cta_url=url,
        ),
    )


def registration_result_email(
    db: AsyncSession,
    registration: RegistrationRequest,
    *,
    approved: bool,
) -> None:
    if approved:
        url = public_url("login.html")
        subject = "Доступ в Borotalk одобрен"
        text = f"Ваш аккаунт активирован. Войти: {url}"
        html = branded_email(
            title="Добро пожаловать в Borotalk",
            preview="Ваш аккаунт активирован.",
            body_html=(
                "<p style=\"margin:0 0 22px\">Ваш аккаунт активирован. "
                "Можно заходить в голосовые комнаты, вступать на серверы и общаться.</p>"
            ),
            cta_label="Открыть Borotalk",
            cta_url=url,
            note="Это письмо отправлено после активации вашей заявки.",
        )
    else:
        subject = "Заявка в Borotalk отклонена"
        text = "Владелец Borotalk отклонил заявку. Новую заявку можно отправить через 7 дней."
        html = branded_email(
            title="Заявка не одобрена",
            preview="Результат рассмотрения заявки в Borotalk.",
            body_html=(
                "<p style=\"margin:0 0 22px\">Владелец пространства отклонил заявку. "
                "Новую заявку можно отправить через 7 дней.</p>"
            ),
            note="Если это решение кажется ошибочным, свяжитесь с владельцем пространства.",
        )
    enqueue_email(db, registration.email, subject, text, html)


async def validate_and_reserve_invite(
    db: AsyncSession,
    invite_code: str | None,
) -> Invite | None:
    if not invite_code:
        return None
    invite = (
        await db.execute(
            select(Invite).where(Invite.code == invite_code).with_for_update()
        )
    ).scalar_one_or_none()
    now = utcnow()
    if not invite:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid invite code")
    if invite.revoked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite code has been revoked")
    if invite.expires_at and invite.expires_at < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite code has expired")
    if invite.max_uses and invite.current_uses >= invite.max_uses:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite code has reached maximum uses")
    invite.current_uses += 1
    return invite


async def ensure_registration_identity_available(
    db: AsyncSession,
    email: str,
    username: str,
    *,
    exclude_registration_id: int | None = None,
    mask_email_conflicts: bool = False,
) -> None:
    email = email.lower()
    if (await db.execute(select(User.id).where(User.email == email))).scalar_one_or_none() is not None:
        if mask_email_conflicts:
            raise RegistrationEmailUnavailable
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    if (await db.execute(select(User.id).where(User.username == username))).scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken")
    pending_email_query = select(RegistrationRequest.id).where(
        RegistrationRequest.status.in_(ACTIVE_REGISTRATION_STATES),
        RegistrationRequest.email == email,
    )
    pending_username_query = select(RegistrationRequest.id).where(
        RegistrationRequest.status.in_(ACTIVE_REGISTRATION_STATES),
        RegistrationRequest.username == username,
    )
    if exclude_registration_id is not None:
        pending_email_query = pending_email_query.where(
            RegistrationRequest.id != exclude_registration_id
        )
        pending_username_query = pending_username_query.where(
            RegistrationRequest.id != exclude_registration_id
        )
    if (await db.execute(pending_email_query)).scalar_one_or_none() is not None:
        if mask_email_conflicts:
            raise RegistrationEmailUnavailable
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Registration request already pending")
    if (await db.execute(pending_username_query)).scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Registration request already pending")
    recent_email_rejection = (
        await db.execute(
            select(RegistrationRequest.id).where(
                RegistrationRequest.status == "rejected",
                RegistrationRequest.reviewed_at > utcnow() - timedelta(days=7),
                RegistrationRequest.email == email,
            )
        )
    ).scalar_one_or_none()
    if recent_email_rejection is not None:
        if mask_email_conflicts:
            raise RegistrationEmailUnavailable
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="A new request can be submitted 7 days after rejection",
        )
    recent_username_rejection = (
        await db.execute(
            select(RegistrationRequest.id).where(
                RegistrationRequest.status == "rejected",
                RegistrationRequest.reviewed_at > utcnow() - timedelta(days=7),
                RegistrationRequest.username == username,
            )
        )
    ).scalar_one_or_none()
    if recent_username_rejection is not None:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="A new request can be submitted 7 days after rejection",
        )


async def create_registration(
    db: AsyncSession,
    *,
    email: str,
    username: str,
    display_name: str,
    password: str,
    invite_code: str | None,
) -> RegistrationRequest:
    normalized_email = email.strip().lower()
    await ensure_registration_identity_available(
        db,
        normalized_email,
        username,
        mask_email_conflicts=True,
    )
    invite = await validate_and_reserve_invite(db, invite_code)
    raw_token = generate_action_token()
    now = utcnow()
    registration = RegistrationRequest(
        public_id=generate_public_id("reg"),
        email=normalized_email,
        username=username,
        display_name=display_name,
        password_hash=hash_password(password),
        invite_id=invite.id if invite else None,
        status="awaiting_email",
        email_token_hash=hash_token(raw_token),
        email_token_expires_at=now + timedelta(hours=24),
        expires_at=now + timedelta(days=14),
    )
    db.add(registration)
    verification_email(db, registration, raw_token)
    await db.commit()
    await db.refresh(registration)
    return registration


async def create_user_from_registration(
    db: AsyncSession,
    registration: RegistrationRequest,
    *,
    role: str = "member",
) -> User:
    await ensure_registration_identity_available(
        db,
        registration.email,
        registration.username,
        exclude_registration_id=registration.id,
    )
    user = User(
        public_id=generate_public_id("usr"),
        email=registration.email,
        password_hash=registration.password_hash,
        username=registration.username,
        display_name=registration.display_name,
        role=role,
        is_active=True,
        email_verified_at=registration.email_verified_at or utcnow(),
    )
    db.add(user)
    await db.flush()
    return user


async def verify_registration_email(db: AsyncSession, raw_token: str) -> RegistrationRequest:
    now = utcnow()
    registration = (
        await db.execute(
            select(RegistrationRequest)
            .where(RegistrationRequest.email_token_hash == hash_token(raw_token))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not registration or registration.status != "awaiting_email":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or already used token")
    if not registration.email_token_expires_at or registration.email_token_expires_at < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email verification token expired")

    registration.email_verified_at = now
    registration.email_token_hash = None
    registration.email_token_expires_at = None
    is_bootstrap_admin = bool(
        settings.bootstrap_admin_email
        and registration.email.lower() == settings.bootstrap_admin_email.strip().lower()
    )
    if registration.invite_id or is_bootstrap_admin:
        await create_user_from_registration(
            db,
            registration,
            role="admin" if is_bootstrap_admin else "member",
        )
        registration.status = "approved"
        registration.reviewed_at = now
        registration_result_email(db, registration, approved=True)
    else:
        registration.status = "awaiting_approval"
        enqueue_telegram_application(db, registration)
    await db.commit()
    await db.refresh(registration)
    return registration


async def review_registration(
    db: AsyncSession,
    registration: RegistrationRequest,
    *,
    approved: bool,
    reviewer_id: int,
) -> RegistrationRequest:
    if registration.status not in {"awaiting_approval", "approved", "rejected"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Registration is not reviewable")
    desired = "approved" if approved else "rejected"
    if registration.status == "awaiting_approval" and registration.expires_at < utcnow():
        registration.status = "expired"
        await db.commit()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Registration request expired")
    if registration.status in {"approved", "rejected"}:
        if registration.status != desired:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Registration already reviewed")
        return registration
    if approved:
        await create_user_from_registration(db, registration)
    registration.status = desired
    registration.reviewed_by = reviewer_id
    registration.reviewed_at = utcnow()
    registration_result_email(db, registration, approved=approved)
    await db.commit()
    await db.refresh(registration)
    return registration


def create_session_tokens(user_id: int) -> tuple[str, str, RefreshSession]:
    now = utcnow()
    jti = generate_action_token()
    access = create_access_token({"sub": str(user_id)})
    refresh = create_refresh_token({"sub": str(user_id)}, jti=jti)
    session = RefreshSession(
        jti=jti,
        user_id=user_id,
        token_hash=hash_token(refresh),
        expires_at=now + timedelta(days=settings.refresh_token_expire_days),
    )
    return access, refresh, session
