"""Email notification channel plugin."""
from typing import Any, Dict, Optional
import logging

from .base import NotificationChannel

logger = logging.getLogger(__name__)


class EmailChannel(NotificationChannel):
    """Email notification channel using existing email service."""

    async def send(
        self,
        user_id: str,
        event_name: str,
        payload: Dict[str, Any],
        recipient: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Send email notification.

        Args:
            user_id: User ID
            event_name: Event/template name
            payload: Notification payload
            recipient: Email address (overrides config lookup)
            **kwargs: Additional parameters

        Returns:
            Response dict with delivery status
        """
        if not self.enabled:
            return {"success": False, "channel": "email", "reason": "disabled"}

        # This would use the existing email sending implementation
        # For now, delegate to the existing send_notification_emails_sequential function
        try:
            from app.email import send_notification_emails_sequential

            user_email = recipient or kwargs.get("user_email")
            if not user_email:
                return {
                    "success": False,
                    "channel": "email",
                    "reason": "no_recipient_email",
                }

            # Call existing email implementation
            result = await send_notification_emails_sequential(
                recipients=[user_email],
                subject=payload.get("subject", event_name),
                body=payload.get("body", ""),
                html_content=payload.get("html_content"),
            )

            return {
                "success": True,
                "channel": "email",
                "recipient": user_email,
                "delivery_id": f"email_{user_id}_{event_name}",
            }
        except Exception as e:
            logger.error(f"Email send failed: {e}")
            return {
                "success": False,
                "channel": "email",
                "reason": str(e),
            }

    async def health_check(self) -> bool:
        """Check email channel health."""
        if not self.enabled:
            return False

        try:
            # Could check SMTP connection, API availability, etc
            # For now, just return enabled status
            return True
        except Exception as e:
            logger.error(f"Email channel health check failed: {e}")
            return False
