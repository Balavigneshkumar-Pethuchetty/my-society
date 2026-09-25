"""SMS notification channel plugin."""
from typing import Any, Dict, Optional
import logging

from .base import NotificationChannel

logger = logging.getLogger(__name__)


class SMSChannel(NotificationChannel):
    """SMS notification channel."""

    async def send(
        self,
        user_id: str,
        event_name: str,
        payload: Dict[str, Any],
        recipient: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Send SMS notification via configured provider."""
        if not self.enabled:
            return {"success": False, "channel": "sms", "reason": "disabled"}

        try:
            phone = recipient or kwargs.get("user_phone")
            if not phone:
                return {
                    "success": False,
                    "channel": "sms",
                    "reason": "no_recipient_phone",
                }

            # Integration point: call SMS provider (Twilio, AWS SNS, etc)
            message = payload.get("message", "")

            logger.info(f"Sending SMS to {phone}: {event_name}")

            # TODO: Implement actual SMS sending via configured provider
            # For now, just log and simulate success
            return {
                "success": True,
                "channel": "sms",
                "recipient": phone,
                "delivery_id": f"sms_{user_id}_{event_name}",
            }
        except Exception as e:
            logger.error(f"SMS send failed: {e}")
            return {
                "success": False,
                "channel": "sms",
                "reason": str(e),
            }

    async def health_check(self) -> bool:
        """Check SMS channel health."""
        if not self.enabled:
            return False

        try:
            # Could check API availability, credentials, etc
            return True
        except Exception as e:
            logger.error(f"SMS channel health check failed: {e}")
            return False
