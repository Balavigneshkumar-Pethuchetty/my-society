"""
Unified notification system: Novu primary with legacy SMS/Telegram/Email fallback.

This module provides a seamless transition to Novu notification orchestration while
maintaining backward compatibility with the legacy notification system based on
auth-service (SMS/Telegram) and Gmail SMTP.

Usage:
    from shared.novu_notifications import send_unified_notification

    result = await send_unified_notification(
        user_id="user-uuid",
        event_name="refund_approved",
        payload={
            "amount": 100,
            "currency": "INR",
            "event_title": "Annual Gala"
        },
        user_phone="+91-xxx-xxx-1234",
        user_email="user@example.com",
        legacy_message="Your refund has been processed",
        notify_sms=True,
        notify_email=True,
        notify_telegram=True,
    )

    print(f"Sent via {result['source']}: {result['success']}")
"""

import logging
from typing import Optional, Dict, Any

import httpx

from app.config import settings
from app.email import send_notification_emails_sequential
from app.splunk_logger import log_app_error
from shared.novu_client import get_novu_client, set_novu_fallback_handler

logger = logging.getLogger(__name__)


async def _legacy_notification_fallback(
    event_name: str, subscriber_id: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Fallback handler for Novu: send via legacy auth-service + SMTP when Novu unavailable.

    This function is called by the Novu client when Novu is unavailable and the
    notification strategy is NOVU_WITH_FALLBACK.

    Args:
        event_name: Novu event name (e.g., "refund_approved")
        subscriber_id: User UUID
        payload: Notification payload containing legacy message + channel preferences

    Returns:
        Dict with keys: {"success": bool, "id": str or None}
    """
    try:
        legacy_message = payload.get("legacy_message", "")
        if not legacy_message:
            logger.warning("No legacy_message in payload for fallback")
            return {"success": False, "id": None}

        phone = payload.get("user_phone")
        email = payload.get("user_email")
        notify_sms = payload.get("notify_sms", True)
        notify_telegram = payload.get("notify_telegram", True)
        notify_email = payload.get("notify_email", True)

        sent_count = 0

        if email and notify_email and settings.gmail_smtp_user and settings.gmail_app_password:
            try:
                await send_legacy_email(email, payload.get("title", "Notification"), legacy_message)
                sent_count += 1
            except Exception as e:
                logger.error(f"Legacy email fallback failed: {e}", exc_info=True)

        if phone and (notify_sms or notify_telegram) and settings.auth_service_api_key:
            try:
                sent_count += await send_legacy_sms_telegram(phone, legacy_message, notify_sms, notify_telegram)
            except Exception as e:
                logger.error(f"Legacy SMS/Telegram fallback failed: {e}", exc_info=True)

        return {"success": sent_count > 0, "id": f"legacy-fallback-{subscriber_id}"}

    except Exception as e:
        logger.error(f"Legacy notification fallback handler error: {e}", exc_info=True)
        return {"success": False, "id": None}


async def send_legacy_email(email: str, title: str, message: str) -> None:
    """Send email via legacy Gmail SMTP."""
    if not settings.gmail_smtp_user or not settings.gmail_app_password:
        return

    try:
        await httpx.AsyncClient().aclose()
        failures = await httpx.AsyncClient().get
        import asyncio
        failures = await asyncio.to_thread(
            send_notification_emails_sequential,
            [(email, title)],
            message
        )
        if failures:
            for failed_email, error in failures:
                logger.error(f"Email fallback to {failed_email} failed: {error}")
    except Exception as e:
        logger.error(f"Send legacy email failed: {e}", exc_info=True)
        raise


async def send_legacy_sms_telegram(
    phone: str, message: str, notify_sms: bool, notify_telegram: bool
) -> int:
    """Send SMS/Telegram via legacy auth-service. Returns count of channels sent."""
    if not settings.auth_service_api_key:
        return 0

    sent_count = 0
    headers = {"X-Api-Key": settings.auth_service_api_key}

    async with httpx.AsyncClient(timeout=40.0) as client:
        if notify_sms:
            try:
                resp = await client.post(
                    f"{settings.auth_service_url}/api/sms/send",
                    json={"phone": phone, "message": message},
                    headers=headers
                )
                if resp.status_code < 300 and resp.json().get("sent", True):
                    sent_count += 1
                else:
                    logger.warning(f"SMS fallback returned error: {resp.status_code}")
            except Exception as e:
                logger.error(f"SMS fallback failed: {e}")

        if notify_telegram:
            try:
                resp = await client.post(
                    f"{settings.auth_service_url}/api/telegram/send",
                    json={"phone": phone, "message": message},
                    headers=headers
                )
                if resp.status_code < 300 and resp.json().get("sent", True):
                    sent_count += 1
                else:
                    logger.warning(f"Telegram fallback returned error: {resp.status_code}")
            except Exception as e:
                logger.error(f"Telegram fallback failed: {e}")

    return sent_count


async def send_unified_notification(
    user_id: str,
    event_name: str,
    payload: Dict[str, Any],
    user_phone: Optional[str] = None,
    user_email: Optional[str] = None,
    legacy_message: Optional[str] = None,
    notify_sms: bool = True,
    notify_email: bool = True,
    notify_telegram: bool = True,
    tags: Optional[list] = None,
) -> Dict[str, Any]:
    """
    Send a notification via Novu with fallback to legacy system.

    This is the main entry point for sending notifications. It automatically:
    1. Tries to send via Novu (if enabled and configured)
    2. Falls back to legacy auth-service + SMTP if Novu fails (configurable)
    3. Records in-app notification via user-service

    Args:
        user_id: User UUID
        event_name: Novu event/template name (e.g., "refund_approved", "user_approved")
        payload: Data to inject into template
        user_phone: Phone number for SMS/Telegram fallback
        user_email: Email for email fallback
        legacy_message: Text message to send if falling back to legacy (SMS/Telegram/Email)
        notify_sms: Send SMS notification
        notify_email: Send email notification
        notify_telegram: Send Telegram notification
        tags: Optional tags for tracking

    Returns:
        Dict with:
        {
            "source": "novu" | "legacy" | "none",
            "success": bool,
            "id": str (novu_id or legacy-fallback-uuid),
            "data": dict
        }

    Example:
        result = await send_unified_notification(
            user_id=user.id,
            event_name="refund_approved",
            payload={
                "amount": 100,
                "currency": "INR",
                "event_title": "Annual Gala",
                "legacy_message": "Your refund of INR 100.00 has been approved.",
                "title": "Refund Approved"
            },
            user_phone=user.phone,
            user_email=user.email,
            notify_sms=user.notify_sms,
            notify_email=user.notify_email,
        )

        if result["source"] == "novu":
            logger.info(f"Sent via Novu: {result['id']}")
        elif result["source"] == "legacy":
            logger.info(f"Sent via legacy system: {result['id']}")
        else:
            logger.warning(f"Notification delivery failed")
    """
    enhanced_payload = {
        **payload,
        "legacy_message": legacy_message or payload.get("title", "Notification"),
        "user_phone": user_phone,
        "user_email": user_email,
        "notify_sms": notify_sms,
        "notify_email": notify_email,
        "notify_telegram": notify_telegram,
    }

    novu = get_novu_client(fallback_handler=_legacy_notification_fallback)
    result = await novu.send_notification(
        event_name=event_name,
        subscriber_id=user_id,
        payload=enhanced_payload,
        tags=tags,
    )

    logger.info(
        f"Notification sent",
        extra={
            "event": event_name,
            "user_id": user_id,
            "source": result.get("source"),
            "success": result.get("success"),
        }
    )

    return result


def init_novu_fallback() -> None:
    """
    Initialize Novu with fallback handler.

    Call this once during application startup (e.g., in main.py or lifespan)
    to ensure the Novu client is configured with the legacy fallback handler.

    Example:
        from fastapi import FastAPI
        from shared.novu_notifications import init_novu_fallback

        app = FastAPI()

        @app.on_event("startup")
        async def startup():
            init_novu_fallback()
    """
    set_novu_fallback_handler(_legacy_notification_fallback)
    logger.info("Novu fallback handler initialized")
