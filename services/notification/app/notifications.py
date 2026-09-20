"""Core notification sending logic."""
import logging
from typing import Any, Dict, Optional

import httpx

from app.config import settings
from app.models import NotificationSource, SendNotificationResponse

logger = logging.getLogger(__name__)


async def send_via_novu(
    event_name: str, subscriber_id: str, payload: Dict[str, Any]
) -> Dict[str, Any]:
    """Send notification via Novu."""
    if not settings.novu_api_key:
        logger.warning("Novu API key not configured")
        return {"success": False, "source": NotificationSource.NONE, "id": None}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{settings.novu_backend_url}/v1/events/trigger",
                json={
                    "name": event_name,
                    "to": {"subscriberId": subscriber_id},
                    "payload": payload,
                },
                headers={"Authorization": f"ApiKey {settings.novu_api_key}"},
            )

            if response.status_code < 300:
                data = response.json()
                return {
                    "success": True,
                    "source": NotificationSource.NOVU,
                    "id": data.get("data", {}).get("transactionId"),
                    "data": data,
                }
            else:
                logger.error(
                    f"Novu API error: {response.status_code}",
                    extra={"response": response.text, "event": event_name},
                )
                return {
                    "success": False,
                    "source": NotificationSource.NONE,
                    "id": None,
                    "error": response.text,
                }
    except Exception as e:
        logger.error(f"Novu notification failed: {e}", exc_info=True)
        return {"success": False, "source": NotificationSource.NONE, "id": None, "error": str(e)}


async def send_legacy_email(email: str, title: str, message: str) -> bool:
    """Send email via Gmail SMTP."""
    if not settings.gmail_smtp_user or not settings.gmail_app_password:
        return False

    try:
        from app.email import send_notification_emails_sequential
        import asyncio

        failures = await asyncio.to_thread(
            send_notification_emails_sequential, [(email, title)], message
        )
        return len(failures) == 0
    except Exception as e:
        logger.error(f"Email send failed: {e}", exc_info=True)
        return False


async def send_legacy_sms_telegram(
    phone: str, message: str, notify_sms: bool, notify_telegram: bool
) -> int:
    """Send SMS/Telegram via legacy auth-service. Returns count of channels sent."""
    if not settings.auth_service_api_key or not phone:
        return 0

    sent_count = 0
    headers = {"X-Api-Key": settings.auth_service_api_key}

    async with httpx.AsyncClient(timeout=40.0) as client:
        if notify_sms:
            try:
                resp = await client.post(
                    f"{settings.auth_service_url}/api/sms/send",
                    json={"phone": phone, "message": message},
                    headers=headers,
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
                    headers=headers,
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
) -> SendNotificationResponse:
    """
    Send notification via Novu with fallback to legacy system.

    This is the main entry point for sending notifications. It handles:
    1. Novu delivery (if enabled)
    2. Legacy fallback (SMS/Telegram/Email)
    3. Strategy-based routing
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

    # Try Novu first if enabled
    if settings.novu_strategy in ["NOVU_ONLY", "NOVU_WITH_FALLBACK"]:
        novu_result = await send_via_novu(event_name, user_id, enhanced_payload)
        if novu_result["success"]:
            logger.info(
                f"Notification sent via Novu",
                extra={"event": event_name, "user_id": user_id},
            )
            return SendNotificationResponse(
                source=NotificationSource.NOVU,
                success=True,
                id=novu_result.get("id"),
                data=novu_result.get("data", {}),
            )

    # If Novu failed and fallback enabled, try legacy channels
    if settings.novu_strategy in ["NOVU_WITH_FALLBACK", "FALLBACK_ONLY"]:
        sent_count = 0
        channels_used = []

        # Try email
        if user_email and notify_email:
            try:
                if await send_legacy_email(
                    user_email, payload.get("title", "Notification"), legacy_message or ""
                ):
                    sent_count += 1
                    channels_used.append("email")
            except Exception as e:
                logger.error(f"Legacy email fallback failed: {e}")

        # Try SMS/Telegram
        if user_phone and (notify_sms or notify_telegram):
            try:
                sms_sent = await send_legacy_sms_telegram(
                    user_phone, legacy_message or "", notify_sms, notify_telegram
                )
                if sms_sent > 0:
                    sent_count += sms_sent
                    if notify_sms:
                        channels_used.append("sms")
                    if notify_telegram:
                        channels_used.append("telegram")
            except Exception as e:
                logger.error(f"Legacy SMS/Telegram fallback failed: {e}")

        if sent_count > 0:
            logger.info(
                f"Notification sent via legacy channels",
                extra={
                    "event": event_name,
                    "user_id": user_id,
                    "channels": channels_used,
                },
            )
            return SendNotificationResponse(
                source=NotificationSource.LEGACY_EMAIL
                if "email" in channels_used
                else NotificationSource.LEGACY_SMS,
                success=True,
                id=f"legacy-{user_id}",
                data={"channels": channels_used},
            )

    logger.warning(
        f"Notification delivery failed for all channels",
        extra={"event": event_name, "user_id": user_id},
    )
    return SendNotificationResponse(
        source=NotificationSource.NONE, success=False, id=None, message="No delivery channels available"
    )
