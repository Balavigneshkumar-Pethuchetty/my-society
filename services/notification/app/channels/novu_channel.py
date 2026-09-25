"""Novu notification channel plugin."""
from typing import Any, Dict, Optional
import logging

from .base import NotificationChannel

logger = logging.getLogger(__name__)


class NovuChannel(NotificationChannel):
    """Novu platform notification channel."""

    async def send(
        self,
        user_id: str,
        event_name: str,
        payload: Dict[str, Any],
        recipient: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Send notification via Novu platform."""
        if not self.enabled:
            return {"success": False, "channel": "novu", "reason": "disabled"}

        try:
            from app.notifications import send_via_novu

            # Use existing Novu implementation
            result = await send_via_novu(
                user_id=user_id,
                event_name=event_name,
                payload=payload,
            )

            return {
                "success": True,
                "channel": "novu",
                "delivery_id": result.get("id", f"novu_{user_id}_{event_name}"),
            }
        except Exception as e:
            logger.error(f"Novu send failed: {e}")
            return {
                "success": False,
                "channel": "novu",
                "reason": str(e),
            }

    async def health_check(self) -> bool:
        """Check Novu channel health."""
        if not self.enabled:
            return False

        try:
            # Could check Novu API availability
            from app.config import settings
            return bool(settings.novu_api_key)
        except Exception as e:
            logger.error(f"Novu channel health check failed: {e}")
            return False
