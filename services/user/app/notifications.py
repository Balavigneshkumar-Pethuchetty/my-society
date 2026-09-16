"""Notify active admins about leave-society events (request submitted, member
finalized) via in-app notification, SMS, Telegram, and email. See ~/auth-service's
/api/sms/send and /api/telegram/send for the SMS/Telegram delivery transport;
email is sent directly via app.email's Gmail SMTP.

Split in two so the outbound HTTP/SMTP fan-out never happens while a pooled DB
connection is held open:
  - notify_admins() runs inside the caller's existing
    `async with pool.acquire() as conn:` block — it records the in-app
    notification row for every active admin and returns their phone/email.
  - send_channels() runs after that block exits, via BackgroundTasks, since
    auth-service's SMS failover chain (and SMTP) can take several seconds
    worst case and must not sit on the resident's request/response cycle.
"""
import asyncio
from uuid import UUID

import httpx

from app.config import settings
from app.email import send_notification_emails_sequential
from app.splunk_logger import log_app_error
from app import crypto


def _mask_phone(phone: str) -> str:
    return "*" * max(0, len(phone) - 4) + phone[-4:] if len(phone) >= 4 else "***"


async def notify_admins(
    conn, type_: str, title: str, message: str,
    related_id: UUID | None = None, exclude_user_id: UUID | None = None,
) -> list[dict]:
    query = (
        "SELECT id, phone, email, notify_sms, notify_email, notify_telegram "
        "FROM users WHERE role = 'admin' AND is_active = TRUE"
    )
    params: list = []
    if exclude_user_id:
        query += " AND id != $1"
        params.append(exclude_user_id)
    rows = await conn.fetch(query, *params)

    for r in rows:
        await conn.execute(
            "INSERT INTO core.notification (user_id, type, title, message, related_id) VALUES ($1, $2, $3, $4, $5)",
            r["id"], type_, title, message, related_id,
        )
    return [
        {
            "phone": crypto.decrypt(r["phone"]), "email": crypto.decrypt(r["email"]), "title": title,
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
