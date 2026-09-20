"""
Centralized Novu notification client with fallback support.
Provides a unified interface for sending notifications across multiple channels:
- SMS (via Twilio/custom provider)
- Telegram
- In-app notifications
- Email (optional)

Primary: Novu for centralized notification orchestration
Fallback: Legacy auth-service SMS/Telegram + Gmail SMTP when Novu unavailable
"""

import logging
from typing import Optional, Dict, Any, Callable
from enum import Enum

import httpx
from app.config import settings

logger = logging.getLogger(__name__)


class NotificationStrategy(str, Enum):
    """Notification delivery strategy"""
    NOVU_ONLY = "novu_only"
    LEGACY_ONLY = "legacy_only"
    NOVU_WITH_FALLBACK = "novu_with_fallback"  # Try Novu first, fall back to legacy


class NovuNotificationClient:
    """
    Unified notification client using Novu with optional fallback to legacy system.

    Strategy (configurable via NOTIFICATION_STRATEGY env var):
    - NOVU_ONLY: Use Novu exclusively, disable legacy channels
    - LEGACY_ONLY: Use legacy auth-service + SMTP (no Novu)
    - NOVU_WITH_FALLBACK: Try Novu first, silently fall back to legacy if unavailable

    Instead of managing SMS, Telegram, and in-app notifications separately,
    this client sends events to Novu which handles:
    - Channel routing (SMS -> Telegram fallback)
    - Retries and error handling
    - Delivery tracking
    - Template management
    """

    def __init__(self, fallback_handler: Optional[Callable] = None):
        self.api_key = settings.novu_api_key
        self.base_url = settings.novu_base_url or "http://novu-api:3000"
        self.strategy = NotificationStrategy(
            getattr(settings, "notification_strategy", NotificationStrategy.NOVU_WITH_FALLBACK)
        )
        self.fallback_handler = fallback_handler
        self.enabled = bool(self.api_key)

        self.client = httpx.AsyncClient(
            base_url=self.base_url,
            headers={"Authorization": f"ApiKey {self.api_key}"},
            timeout=10.0
        ) if self.enabled else None

        logger.info(f"NovuNotificationClient initialized with strategy: {self.strategy}, enabled: {self.enabled}")

    async def send_notification(
        self,
        event_name: str,
        subscriber_id: str,
        payload: Dict[str, Any],
        tags: Optional[list] = None,
        override_preferences: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Send a notification via Novu with optional fallback to legacy system.

        Args:
            event_name: Novu workflow/template name (e.g., 'refund_approved', 'user_approved')
            subscriber_id: User UUID to send notification to
            payload: Data to inject into the template (e.g., {"amount": 100, "orderId": "xyz"})
            tags: Optional tags for tracking/filtering (e.g., ["refund", "payment"])
            override_preferences: Channel preference overrides for this notification

        Returns:
            Dict with keys: {
                "source": "novu" | "legacy" | "none",
                "success": bool,
                "id": str (novu_id or transaction_ref if fallback),
                "data": dict (raw response)
            }

        Example:
            result = await novu.send_notification(
                event_name="refund_approved",
                subscriber_id=user_id,
                payload={"amount": 100, "currency": "INR"},
                tags=["refund", "payment"]
            )
            assert result["source"] in ("novu", "legacy")
        """

        if self.strategy == NotificationStrategy.LEGACY_ONLY:
            return await self._fallback_send(event_name, subscriber_id, payload)

        if not self.enabled:
            if self.strategy == NotificationStrategy.NOVU_WITH_FALLBACK:
                logger.warning("Novu unavailable - falling back to legacy notification system")
                return await self._fallback_send(event_name, subscriber_id, payload)
            else:
                logger.warning("Novu is disabled and fallback is disabled")
                return {"source": "none", "success": False, "id": None, "data": {}}

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
                novu_id = data.get("data", {}).get("id")
                logger.info(
                    f"Notification sent successfully via Novu",
                    extra={
                        "event": event_name,
                        "user_id": subscriber_id,
                        "novu_id": novu_id,
                    }
                )
                return {
                    "source": "novu",
                    "success": True,
                    "id": novu_id,
                    "data": data
                }
            else:
                logger.warning(
                    f"Novu API error: {response.status_code}, falling back",
                    extra={
                        "event": event_name,
                        "user_id": subscriber_id,
                        "response": response.text,
                    }
                )
                if self.strategy == NotificationStrategy.NOVU_WITH_FALLBACK:
                    return await self._fallback_send(event_name, subscriber_id, payload)
                else:
                    return {"source": "novu", "success": False, "id": None, "data": {}}

        except (httpx.TimeoutException, httpx.ConnectError) as e:
            logger.warning(
                f"Novu API unavailable ({type(e).__name__}), falling back",
                extra={"event": event_name, "user_id": subscriber_id}
            )
            if self.strategy == NotificationStrategy.NOVU_WITH_FALLBACK:
                return await self._fallback_send(event_name, subscriber_id, payload)
            else:
                return {"source": "novu", "success": False, "id": None, "data": {}}
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
            if self.strategy == NotificationStrategy.NOVU_WITH_FALLBACK:
                return await self._fallback_send(event_name, subscriber_id, payload)
            else:
                return {"source": "novu", "success": False, "id": None, "data": {}}

    async def _fallback_send(
        self, event_name: str, subscriber_id: str, payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Fallback to legacy notification system when Novu is unavailable.

        This calls the registered fallback_handler if available, or returns a
        safe "not sent" response if no fallback is configured.

        The fallback_handler is expected to accept:
          - event_name: str (e.g., "refund_approved")
          - subscriber_id: str (user UUID)
          - payload: dict (notification data)

        And return a dict with:
          - "success": bool
          - "id": str or None
        """
        if not self.fallback_handler:
            logger.error(
                f"No fallback handler configured - notification lost",
                extra={"event": event_name, "user_id": subscriber_id}
            )
            return {"source": "legacy", "success": False, "id": None, "data": {}}

        try:
            logger.info(
                f"Sending notification via legacy fallback handler",
                extra={"event": event_name, "user_id": subscriber_id}
            )
            result = await self.fallback_handler(event_name, subscriber_id, payload)
            result["source"] = "legacy"
            return result
        except Exception as e:
            logger.error(
                f"Fallback handler failed: {str(e)}",
                extra={
                    "event": event_name,
                    "user_id": subscriber_id,
                    "error": str(e),
                },
                exc_info=True
            )
            return {"source": "legacy", "success": False, "id": None, "data": {}}

    async def send_bulk_notifications(
        self,
        event_name: str,
        subscriber_ids: list,
        payload: Dict[str, Any],
        tags: Optional[list] = None,
    ) -> Dict[str, Any]:
        """
        Send notification to multiple subscribers.

        Args:
            event_name: Template name
            subscriber_ids: List of user UUIDs
            payload: Data for template
            tags: Optional tags

        Returns:
            Dict with counts and details:
            {
                "successful": 5,
                "failed": 1,
                "by_source": {"novu": 5, "legacy": 0, "none": 1}
            }
        """
        results = {
            "successful": 0,
            "failed": 0,
            "by_source": {"novu": 0, "legacy": 0, "none": 0}
        }

        for subscriber_id in subscriber_ids:
            response = await self.send_notification(
                event_name=event_name,
                subscriber_id=subscriber_id,
                payload=payload,
                tags=tags,
            )
            source = response.get("source", "none")
            if response.get("success"):
                results["successful"] += 1
                results["by_source"][source] = results["by_source"].get(source, 0) + 1
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


def get_novu_client(fallback_handler: Optional[Callable] = None) -> NovuNotificationClient:
    """
    Get or create the Novu client singleton.

    Args:
        fallback_handler: Optional async function to handle fallback notifications.
                         Called when Novu is unavailable and strategy is NOVU_WITH_FALLBACK.
                         Signature: async fn(event_name: str, subscriber_id: str, payload: dict) -> dict

    Returns:
        NovuNotificationClient singleton instance
    """
    global _novu_client
    if _novu_client is None:
        _novu_client = NovuNotificationClient(fallback_handler=fallback_handler)
    return _novu_client


def set_novu_fallback_handler(handler: Callable) -> None:
    """Configure the fallback handler for an already-initialized client."""
    global _novu_client
    if _novu_client is not None:
        _novu_client.fallback_handler = handler
