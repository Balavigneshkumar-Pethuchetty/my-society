"""
Notification fan-out for visitor-service. Every trigger sends both an in-app
bell notification (written on user-service, which owns the shared
`notification` table NotificationBell.tsx reads) and SMS/Telegram (sent
directly via ~/auth-service, same transport used by
services/registration/app/notifications.py's send_channels()).

Phone verification (OTP) is a separate concern — it delegates wholesale to
auth-service's existing /api/otp/request and /api/otp/verify (the same API
services/user/app/routes/users.py uses for a resident's own phone
verification), rather than inventing a local secret-code generator.

All sends are best-effort: a failed SMS/Telegram/bell write is logged and
swallowed so it never blocks the gate-scan/pass-creation request that
triggered it.
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_INTERNAL_HEADERS = {"X-Internal-Key": settings.internal_api_key}
_AUTH_HEADERS = {"X-Api-Key": settings.auth_service_api_key}


async def notify_in_app(user_id: str, type_: str, title: str, message: str, related_id: str | None = None) -> None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.post(
                f"{settings.user_service_internal_url}/{user_id}/notifications",
                json={"type": type_, "title": title, "message": message, "related_id": related_id},
                headers=_INTERNAL_HEADERS,
            )
            if resp.status_code >= 300:
                logger.warning("in-app notification failed for %s: HTTP %s", user_id, resp.status_code)
    except Exception:
        logger.exception("in-app notification failed for %s", user_id)


async def send_sms_telegram(phone: str | None, message: str) -> None:
    if not phone or not settings.auth_service_api_key:
        return
    async with httpx.AsyncClient(timeout=15) as client:
        for url in (f"{settings.auth_service_url}/api/sms/send", f"{settings.auth_service_url}/api/telegram/send"):
            try:
                resp = await client.post(url, json={"phone": phone, "message": message}, headers=_AUTH_HEADERS)
                if resp.status_code >= 300:
                    logger.warning("channel send failed: %s -> HTTP %s", url, resp.status_code)
            except Exception:
                logger.exception("channel send failed: %s", url)


async def notify_all(
    user_id: str, phone: str | None, type_: str, title: str, message: str, related_id: str | None = None,
) -> None:
    await notify_in_app(user_id, type_, title, message, related_id)
    await send_sms_telegram(phone, message)


async def broadcast_to_role(role: str, type_: str, title: str, message: str, related_id: str | None = None) -> None:
    from app.user_client import list_by_role
    try:
        users = await list_by_role(role)
    except Exception:
        logger.exception("failed to list users with role=%s for broadcast", role)
        return
    for u in users:
        await notify_all(u["id"], u.get("phone"), type_, title, message, related_id)


# ── Phone verification (delegates to auth-service's OTP API) ────────────────
# Returns the raw httpx.Response (not raise_for_status()'d) so callers can
# handle auth-service's 429 rate-limit / non-200 bodies themselves, same as
# services/user/app/routes/users.py's request_phone_verification does.

async def request_otp(phone: str) -> httpx.Response:
    async with httpx.AsyncClient(timeout=15) as client:
        return await client.post(
            f"{settings.auth_service_url}/api/otp/request",
            json={"phone": phone},
            headers=_AUTH_HEADERS,
        )


async def verify_otp(request_id: str, code: str) -> httpx.Response:
    async with httpx.AsyncClient(timeout=15) as client:
        return await client.post(
            f"{settings.auth_service_url}/api/otp/verify",
            json={"request_id": request_id, "code": code},
            headers=_AUTH_HEADERS,
        )
