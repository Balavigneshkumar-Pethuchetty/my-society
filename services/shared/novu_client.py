"""
Centralized Novu notification client for all services.
Provides a unified interface for sending notifications across multiple channels:
- SMS (via Twilio/custom provider)
- Telegram
- In-app notifications
- Email (optional)
"""

import logging
from typing import Optional, Dict, Any
from datetime import datetime

import httpx
from app.config import settings

logger = logging.getLogger(__name__)


class NovuNotificationClient:
    """
    Unified notification client using Novu as the notification orchestration layer.

    Instead of managing SMS, Telegram, and in-app notifications separately,
    this client sends events to Novu which handles:
    - Channel routing (SMS -> Telegram fallback)
    - Retries and error handling
    - Delivery tracking
    - Template management
    """

    def __init__(self):
        self.api_key = settings.novu_api_key
        self.base_url = settings.novu_base_url or "http://novu-api:3000"
        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"Authorization": f"ApiKey {self.api_key}"},
            timeout=10.0
        )
        self.enabled = bool(self.api_key)

    async def send_notification(
        self,
        event_name: str,
        subscriber_id: str,
        payload: Dict[str, Any],
        tags: Optional[list] = None,
        override_preferences: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Send a notification via Novu.

        Args:
            event_name: Novu workflow/template name (e.g., 'refund_approved', 'user_approved')
            subscriber_id: User UUID to send notification to
            payload: Data to inject into the template (e.g., {"amount": 100, "orderId": "xyz"})
            tags: Optional tags for tracking/filtering (e.g., ["refund", "payment"])
            override_preferences: Channel preference overrides for this notification

        Returns:
            Response data if successful, None if disabled or failed

        Example:
            await novu.send_notification(
                event_name="refund_approved",
                subscriber_id=user_id,
                payload={"amount": 100, "currency": "INR"},
                tags=["refund", "payment"]
            )
        """

        if not self.enabled:
            logger.warning("Novu is disabled - set NOVU_API_KEY to enable")
            return None

        try:
            request_data = {
                "name": event_name,
                "to": {
                    "subscriberId": str(subscriber_id),
                },
                "payload": payload,
            }

            if tags:
                request_data["tags"] = tags

            if override_preferences:
                request_data["overrides"] = override_preferences

            response = await self.client.post(
                "/v1/events/trigger",
                json=request_data
            )

            if response.status_code == 201:
                data = response.json()
                logger.info(
                    f"Notification sent successfully",
                    extra={
                        "event": event_name,
                        "user_id": subscriber_id,
                        "novu_id": data.get("data", {}).get("id"),
                    }
                )
                return data
            else:
                logger.error(
                    f"Novu API error: {response.status_code}",
                    extra={
                        "event": event_name,
                        "user_id": subscriber_id,
                        "response": response.text,
                    }
                )
                return None

        except httpx.TimeoutException:
            logger.error(
                "Novu API timeout",
                extra={"event": event_name, "user_id": subscriber_id}
            )
            return None
        except Exception as e:
            logger.error(
                f"Failed to send notification via Novu: {str(e)}",
                extra={
                    "event": event_name,
                    "user_id": subscriber_id,
                    "error": str(e),
                },
                exc_info=True
            )
            return None

    async def send_bulk_notifications(
        self,
        event_name: str,
        subscriber_ids: list,
        payload: Dict[str, Any],
        tags: Optional[list] = None,
    ) -> Dict[str, int]:
        """
        Send notification to multiple subscribers.

        Args:
            event_name: Template name
            subscriber_ids: List of user UUIDs
            payload: Data for template
            tags: Optional tags

        Returns:
            Dict with counts: {"successful": 5, "failed": 1}
        """
        results = {"successful": 0, "failed": 0}

        for subscriber_id in subscriber_ids:
            response = await self.send_notification(
                event_name=event_name,
                subscriber_id=subscriber_id,
                payload=payload,
                tags=tags,
            )
            if response:
                results["successful"] += 1
            else:
                results["failed"] += 1

        return results

    async def get_notification_status(self, novu_id: str) -> Optional[Dict[str, Any]]:
        """
        Check the delivery status of a notification.

        Args:
            novu_id: Notification ID returned by send_notification

        Returns:
            Status data with delivery details
        """
        if not self.enabled:
            return None

        try:
            response = await self.client.get(f"/v1/notifications/{novu_id}")
            if response.status_code == 200:
                return response.json()
        except Exception as e:
            logger.error(f"Failed to get notification status: {e}")

        return None

    async def sync_subscriber(
        self,
        subscriber_id: str,
        email: Optional[str] = None,
        phone: Optional[str] = None,
        first_name: Optional[str] = None,
        last_name: Optional[str] = None,
        custom_data: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Create or update a subscriber in Novu.

        This should be called when:
        - A new user is created
        - User updates phone/email
        - User preferences change

        Args:
            subscriber_id: User UUID
            email: User email
            phone: User phone number
            first_name: User's first name
            last_name: User's last name
            custom_data: Additional custom data

        Returns:
            Subscriber data if successful
        """
        if not self.enabled:
            return None

        try:
            request_data = {
                "subscriberId": str(subscriber_id),
            }

            if email:
                request_data["email"] = email
            if phone:
                request_data["phone"] = phone
            if first_name:
                request_data["firstName"] = first_name
            if last_name:
                request_data["lastName"] = last_name
            if custom_data:
                request_data["data"] = custom_data

            response = await self.client.post(
                "/v1/subscribers",
                json=request_data
            )

            if response.status_code in (201, 200):
                logger.info(f"Subscriber synced: {subscriber_id}")
                return response.json()
            else:
                logger.error(f"Failed to sync subscriber: {response.text}")
        except Exception as e:
            logger.error(f"Failed to sync subscriber: {e}", exc_info=True)

        return None

    async def close(self):
        """Close the HTTP client connection."""
        await self.client.aclose()


# Singleton instance
_novu_client: Optional[NovuNotificationClient] = None


def get_novu_client() -> NovuNotificationClient:
    """Get or create the Novu client singleton."""
    global _novu_client
    if _novu_client is None:
        _novu_client = NovuNotificationClient()
    return _novu_client
