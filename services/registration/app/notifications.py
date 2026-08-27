"""Notify whoever manages an event (organizer + active event_permission
grantees) via in-app notification, SMS, Telegram, and email — used when a
resident submits a payment-verification screenshot, cancels a booking, or
that cancellation triggers a refund request. See ~/auth-service's
/api/sms/send and /api/telegram/send for the SMS/Telegram delivery
transport; email is sent directly via app.email's Gmail SMTP.

Split in two so the outbound HTTP/SMTP fan-out never happens while a pooled
DB connection is held open (max_size — see database.py):
  - resolve_and_record() runs inside the caller's existing
    `async with pool.acquire() as conn:` block.
  - send_channels() runs after that block exits, via BackgroundTasks, since
    auth-service's SMS failover chain (and SMTP) can take several seconds
    worst case and must not sit on the resident's request/response cycle.
"""
import asyncio

import httpx

from app.config import settings
from app.email import send_notification_emails_sequential
from app.splunk_logger import log_app_error


def _mask_phone(phone: str) -> str:
    return "*" * max(0, len(phone) - 4) + phone[-4:] if len(phone) >= 4 else "***"


async def resolve_and_record(
    conn, event_id: str, actor_user_id: str, type_: str, title: str, message: str, related_id: str | None = None,
) -> list[dict]:
    rows = await conn.fetch(
        "SELECT u.id, u.phone, u.email, u.notify_sms, u.notify_email, u.notify_telegram FROM users u "
        "WHERE (u.id = (SELECT organizer_id FROM event WHERE id = $1::uuid) "
        "   OR u.id IN (SELECT user_id FROM event_permission WHERE event_id = $1::uuid AND revoked_at IS NULL)) "
        "  AND u.id != $2::uuid",
        event_id, actor_user_id,
    )
    for r in rows:
        await conn.execute(
            "INSERT INTO notification (user_id, event_id, type, title, message, related_id) "
            "VALUES ($1, $2::uuid, $3, $4, $5, $6)",
            r["id"], event_id, type_, title, message, related_id,
        )
    return [
        {
            "id": str(r["id"]), "phone": r["phone"], "email": r["email"], "title": title,
            "notify_sms": r["notify_sms"], "notify_email": r["notify_email"], "notify_telegram": r["notify_telegram"],
        }
        for r in rows
    ]


async def send_channels(recipients: list[dict], message: str) -> None:
    """Sends one recipient at a time (not fanned out concurrently) so a
    broadcast to hundreds/thousands of users doesn't fire a burst of
    simultaneous SMTP logins or HTTP calls — see send_notification_emails_sequential
    for why that matters for Gmail specifically. A failure on one recipient
    is logged and processing continues with the next."""
    if not recipients:
        return

    if settings.gmail_smtp_user and settings.gmail_app_password:
        email_recipients = [
            (r["email"], r.get("title") or "Notification")
            for r in recipients if r.get("email") and r.get("notify_email", True)
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
