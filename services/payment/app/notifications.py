"""Notify whoever manages an event (organizer + active event_permission
grantees) via in-app notification, SMS, Telegram, and email — used when a
resident submits a payment-verification screenshot, cancels a booking, or
that cancellation triggers a refund request. See ~/auth-service's
/api/sms/send and /api/telegram/send for the SMS/Telegram delivery
transport; email is sent directly via app.email's Gmail SMTP.

notify_refund_processed() / notify_payment_verdict() are the resident-facing
counterparts: they resolve the single resident who owns a
payment_transaction (rather than the event's organizer/permission
grantees) and notify them once their refund has been paid out, or once
their checkout screenshot has been reviewed (verified/rejected).

Split in two so the outbound HTTP/SMTP fan-out never happens while a pooled
DB connection is held open (max_size=10 — see database.py):
  - resolve_and_record() / notify_refund_processed() / notify_payment_verdict()
    run inside the caller's existing `async with pool.acquire() as conn:` block.
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


async def notify_refund_processed(
    conn, txn_ref: str, actor_sub: str,
) -> tuple[list[dict], str] | tuple[None, None]:
    row = await conn.fetchrow(
        "SELECT pt.id::text AS txn_id, pt.user_id::text AS user_id, pt.event_id::text AS event_id, "
        "       pt.registration_id::text AS registration_id, "
        "       pt.amount, pt.currency, e.title AS event_title, u.phone, u.email, "
        "       u.notify_sms, u.notify_email, u.notify_telegram, "
        "       (SELECT name FROM users WHERE keycloak_sub = $2) AS actor_name "
        "FROM payment_transaction pt "
        "JOIN event e ON e.id = pt.event_id "
        "JOIN users u ON u.id = pt.user_id "
        "WHERE pt.txn_ref = $1",
        txn_ref, actor_sub,
    )
    if not row:
        return None, None

    actor_name = row["actor_name"] or "the event organizer"
    link = f"{settings.app_public_url}/payments?txn_ref={txn_ref}"
    message = (
        f"Your refund of {row['currency']} {float(row['amount']):.2f} for "
        f"\"{row['event_title']}\" has been processed by {actor_name}. Details: {link}"
    )
    await conn.execute(
        "INSERT INTO notification (user_id, event_id, type, title, message, related_id) "
        "VALUES ($1::uuid, $2::uuid, 'refund_processed', 'Refund processed', $3, $4::uuid)",
        row["user_id"], row["event_id"], message, row["txn_id"],
    )
    # The refund task queue item — and, if this refund was triggered by a ticket
    # cancellation, the paired "Registration cancelled" FYI — are both fully
    # resolved now, so clear them out of the admin/organizer notification popup.
    await conn.execute(
        "DELETE FROM notification WHERE type = 'refund_requested' AND related_id = $1::uuid",
        row["txn_id"],
    )
    if row["registration_id"]:
        await conn.execute(
            "DELETE FROM notification WHERE type = 'cancellation_requested' AND related_id = $1::uuid",
            row["registration_id"],
        )
    return [{
        "phone": row["phone"], "email": row["email"], "title": "Refund processed",
        "notify_sms": row["notify_sms"], "notify_email": row["notify_email"], "notify_telegram": row["notify_telegram"],
    }], message


async def notify_payment_verdict(
    conn, txn_ref: str, verdict: str, remark: str | None = None,
) -> tuple[list[dict], str] | tuple[None, None]:
    """verdict is 'verified' (paid) or 'cancelled' (unpaid/rejected). remark, if given
    (the reviewer's comment from the approve/reject/quick-review form), is appended so
    the resident sees *why*, not just the verdict."""
    row = await conn.fetchrow(
        "SELECT pt.id::text AS txn_id, pt.user_id::text AS user_id, pt.event_id::text AS event_id, "
        "       pt.registration_id::text AS registration_id, "
        "       pt.amount, pt.currency, e.title AS event_title, u.phone, u.email, "
        "       u.notify_sms, u.notify_email, u.notify_telegram "
        "FROM payment_transaction pt "
        "JOIN event e ON e.id = pt.event_id "
        "JOIN users u ON u.id = pt.user_id "
        "WHERE pt.txn_ref = $1",
        txn_ref,
    )
    if not row:
        return None, None

    amount_str = f"{row['currency']} {float(row['amount']):.2f}"
    if verdict == "verified":
        type_, title = "payment_success", "Payment verified"
        link = f"{settings.app_public_url}/payments?txn_ref={txn_ref}"
        message = (
            f"Your payment of {amount_str} for \"{row['event_title']}\" has been "
            f"verified. Your registration is confirmed. Details: {link}"
        )
    else:
        type_, title = "payment_rejected", "Payment could not be verified"
        link = (
            f"{settings.app_public_url}/checkout?registration_id={row['registration_id']}"
            if row["registration_id"] else f"{settings.app_public_url}/payments?txn_ref={txn_ref}"
        )
        message = (
            f"Your payment of {amount_str} for \"{row['event_title']}\" could not be "
            f"verified against the bank statement. Please re-upload your payment "
            f"screenshot to try again: {link}"
        )

    if remark:
        message += f"\n\nReviewer's comment: {remark}"

    await conn.execute(
        "INSERT INTO notification (user_id, event_id, type, title, message, related_id) "
        "VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)",
        row["user_id"], row["event_id"], type_, title, message, row["txn_id"],
    )
    # Verified or rejected — the reviewer's action item is resolved either way,
    # so clear the "Payment verification requested" card from their popup.
    await conn.execute(
        "DELETE FROM notification WHERE type = 'payment_verification_requested' AND related_id = $1::uuid",
        row["txn_id"],
    )
    return [{
        "phone": row["phone"], "email": row["email"], "title": title,
        "notify_sms": row["notify_sms"], "notify_email": row["notify_email"], "notify_telegram": row["notify_telegram"],
    }], message


async def send_channels(
    recipients: list[dict], message: str, buttons: list[tuple[str, str]] | None = None,
) -> None:
    """buttons (label, url) render as styled action links in the email only — SMS/Telegram
    get their URLs from `message` itself (see quick_review links appended in payments.py),
    since Telegram auto-hyperlinks plain URLs and SMS has no concept of HTML buttons.

    Sends one recipient at a time (not fanned out concurrently) so a broadcast
    to hundreds/thousands of users doesn't fire a burst of simultaneous SMTP
    logins or HTTP calls — see send_notification_emails_sequential for why
    that matters for Gmail specifically. A failure on one recipient is logged
    and processing continues with the next."""
    if not recipients:
        return

    if settings.gmail_smtp_user and settings.gmail_app_password:
        email_recipients = [
            (r["email"], r.get("title") or "Notification")
            for r in recipients if r.get("email") and r.get("notify_email", True)
        ]
        if email_recipients:
            failures = await asyncio.to_thread(
                send_notification_emails_sequential, email_recipients, message, buttons,
            )
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
