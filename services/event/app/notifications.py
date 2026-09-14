"""Broadcast an event-details change to every active account, including the
organizer who made the edit — everyone should get a copy confirming what
changed. Distinct from require_event_access()'s narrow organizer/permission-
grantee circle — an edited *published* event (date, venue, price, etc.
changed) is public-facing information residents may have already acted on.

Split in two for the same reason as the other services' notification modules
(registration-service, payment-service): resolve_and_record() runs inside the
caller's pooled DB connection, send_channels() fans out SMS/Telegram/email
afterward via BackgroundTasks so the outbound HTTP/SMTP calls never hold the
connection open.
"""
import asyncio

import httpx

from app.config import settings
from app.email import send_notification_emails_sequential
from app.splunk_logger import log_app_error
from shared.user_client import get_broadcast_targets, post_notification


def _mask_phone(phone: str) -> str:
    return "*" * max(0, len(phone) - 4) + phone[-4:] if len(phone) >= 4 else "***"


async def notify_all_users(
    event_id: str, type_: str, title: str, message: str,
    related_id: str | None = None,
) -> list[dict]:
    """users now lives behind user-service's own API (see DB_ISOLATION_PLAN.md)
    — resolve broadcast targets and write each in-app notification through it
    instead of a direct SELECT + INSERT."""
    users = await get_broadcast_targets()
    for user in users:
        await post_notification(user["id"], type_, title, message, related_id=related_id, event_id=event_id)
    return users


async def send_channels(recipients: list[dict], message: str, title: str) -> None:
    """Sends one recipient at a time (not fanned out concurrently) so a
    broadcast to hundreds/thousands of users doesn't fire a burst of
    simultaneous SMTP logins or HTTP calls — see send_notification_emails_sequential
    for why that matters for Gmail specifically. A failure on one recipient
    is logged and processing continues with the next."""
    if not recipients:
        return

    if settings.gmail_smtp_user and settings.gmail_app_password:
        email_recipients = [
            (r["email"], title) for r in recipients if r.get("email") and r.get("notify_email", True)
        ]
        if email_recipients:
            failures = await asyncio.to_thread(send_notification_emails_sequential, email_recipients, message)
            for email, error in failures:
                await log_app_error({"event": "notify_email_failed", "email": email, "error": error})

    if settings.auth_service_api_key:
        headers = {"X-Api-Key": settings.auth_service_api_key}
        async with httpx.AsyncClient(timeout=40.0) as client:
            for r in recipients:
                phone = r.get("phone")
                if not phone:
                    continue
                channel_urls = []
                if r.get("notify_sms", True):
                    channel_urls.append(f"{settings.auth_service_url}/api/sms/send")
                if r.get("notify_telegram", True):
                    channel_urls.append(f"{settings.auth_service_url}/api/telegram/send")
                for url in channel_urls:
                    try:
                        resp = await client.post(url, json={"phone": phone, "message": message}, headers=headers)
                        if resp.status_code >= 300 or not resp.json().get("sent", True):
                            await log_app_error({
                                "event": "notify_channel_failed", "url": url,
                                "phone": _mask_phone(phone), "status": resp.status_code,
                            })
                    except Exception as exc:
                        await log_app_error({
                            "event": "notify_channel_exception",
                            "phone": _mask_phone(phone), "error": str(exc)[:200],
                        })
