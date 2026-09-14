"""Notify whoever manages an event (organizer + active event_permission
grantees) via in-app notification, SMS, Telegram, and email — used when a
resident submits a payment-verification screenshot, cancels a booking, or
that cancellation triggers a refund request. See ~/auth-service's
/api/sms/send and /api/telegram/send for the SMS/Telegram delivery
transport; email is sent directly via app.email's Gmail SMTP.

resolve_and_record() no longer needs a DB connection — user lookup and the
in-app notification write both go through user-service's internal API now
(see DB_ISOLATION_PLAN.md) — but send_channels() is still split out and run
via BackgroundTasks after the caller's own `async with pool.acquire() as conn:`
block exits, since auth-service's SMS failover chain (and SMTP) can take
several seconds worst case and must not sit on the resident's request/response
cycle.
"""
import asyncio

import httpx

from app.config import settings
from app.email import send_notification_emails_sequential
from app.event_client import get_managers
from app.splunk_logger import log_app_error
from shared.user_client import get_by_ids, post_notification


def _mask_phone(phone: str) -> str:
    return "*" * max(0, len(phone) - 4) + phone[-4:] if len(phone) >= 4 else "***"


async def resolve_and_record(
    event_id: str, actor_user_id: str, type_: str, title: str, message: str, related_id: str | None = None,
) -> list[dict]:
    managers = await get_managers(event_id)
    manager_ids = list({managers["organizer_id"], *managers["manager_user_ids"]} - {actor_user_id})
    if not manager_ids:
        return []
    users = await get_by_ids(manager_ids)
    for user_id in users:
        await post_notification(user_id, type_, title, message, related_id=related_id, event_id=event_id)
    return [
        {
            "id": u["id"], "phone": u.get("phone"), "email": u.get("email"), "title": title,
            "notify_sms": u.get("notify_sms", True), "notify_email": u.get("notify_email", True),
            "notify_telegram": u.get("notify_telegram", True),
        }
        for u in users.values()
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
