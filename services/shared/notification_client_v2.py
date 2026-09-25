"""Graceful notification client with fallback queue for optional notification service."""
import logging
from typing import Any, Dict, Optional
import httpx

logger = logging.getLogger(__name__)


class GracefulNotificationClient:
    """Notification client with graceful degradation when service is unavailable."""

    def __init__(
        self,
        notification_service_url: str,
        internal_api_key: str,
        enable_notifications: bool = True,
        queue_handler: Optional[Any] = None,
    ):
        """Initialize notification client.

        Args:
            notification_service_url: URL to notification service
            internal_api_key: API key for service-to-service communication
            enable_notifications: Whether notifications are enabled
            queue_handler: Optional queue handler for offline persistence
        """
        self.notification_service_url = notification_service_url
        self.internal_api_key = internal_api_key
        self.enable_notifications = enable_notifications
        self.queue_handler = queue_handler

    async def send(
        self,
        user_id: str,
        event_name: str,
        payload: Dict[str, Any],
        user_email: Optional[str] = None,
        user_phone: Optional[str] = None,
        channels: list = None,
        priority: int = 1,
    ) -> Dict[str, Any]:
        """Send notification with graceful fallback.

        Args:
            user_id: User to notify
            event_name: Event/template name
            payload: Notification payload
            user_email: User email (optional)
            user_phone: User phone (optional)
            channels: Notification channels (email, sms, telegram, novu)
            priority: Priority level

        Returns:
            Response dict with status and ID
        """
        if not self.enable_notifications:
            logger.info(f"Notifications disabled, skipping {event_name}")
            return {"success": True, "source": "disabled"}

        channels = channels or ["email"]

        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    f"{self.notification_service_url}/send",
                    json={
                        "user_id": user_id,
                        "event_name": event_name,
                        "payload": payload,
                        "user_email": user_email,
                        "user_phone": user_phone,
                        "notify_email": "email" in channels,
                        "notify_sms": "sms" in channels,
                        "notify_telegram": "telegram" in channels,
                        "tags": [event_name, f"priority_{priority}"],
                    },
                    headers={"X-Api-Key": self.internal_api_key},
                )

                if response.status_code == 200:
                    logger.info(f"Notification {event_name} sent for user {user_id}")
                    return response.json()
                else:
                    logger.warning(
                        f"Notification service returned {response.status_code}, "
                        f"queuing for retry"
                    )
                    return await self._queue_notification(
                        user_id, event_name, payload, channels
                    )

        except httpx.TimeoutException:
            logger.warning(f"Notification service timeout, queuing for retry")
            return await self._queue_notification(
                user_id, event_name, payload, channels
            )
        except httpx.RequestError as e:
            logger.warning(f"Notification service unreachable: {e}, queuing for retry")
            return await self._queue_notification(
                user_id, event_name, payload, channels
            )
        except Exception as e:
            logger.error(f"Unexpected error sending notification: {e}")
            return await self._queue_notification(
                user_id, event_name, payload, channels
            )

    async def _queue_notification(
        self,
        user_id: str,
        event_name: str,
        payload: Dict[str, Any],
        channels: list,
    ) -> Dict[str, Any]:
        """Queue notification for later delivery.

        Args:
            user_id: User to notify
            event_name: Event name
            payload: Notification payload
            channels: Channels to send via

        Returns:
            Response dict indicating queued status
        """
        if not self.queue_handler:
            logger.error("Queue handler not configured, cannot queue notification")
            return {
                "success": False,
                "source": "queue_unavailable",
                "error": "No queue handler configured",
            }

        try:
            queue_id = await self.queue_handler.enqueue(
                user_id=user_id,
                event_name=event_name,
                payload=payload,
                channels=channels,
            )
            logger.info(f"Notification {queue_id} queued for later delivery")
            return {
                "success": True,
                "source": "queued",
                "id": queue_id,
                "message": "Notification queued for later delivery",
            }
        except Exception as e:
            logger.error(f"Failed to queue notification: {e}")
            return {
                "success": False,
                "source": "queue_failed",
                "error": str(e),
            }

    async def send_bulk(
        self,
        user_ids: list,
        event_name: str,
        payload: Dict[str, Any],
        channels: list = None,
    ) -> Dict[str, Any]:
        """Send bulk notifications.

        Args:
            user_ids: List of users to notify
            event_name: Event name
            payload: Notification payload
            channels: Channels to send via

        Returns:
            Response dict with aggregate results
        """
        if not self.enable_notifications:
            return {
                "success": True,
                "total": len(user_ids),
                "successful": 0,
                "failed": 0,
                "source": "disabled",
            }

        channels = channels or ["email"]
        successful = 0
        failed = 0

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.notification_service_url}/bulk",
                    json={
                        "user_ids": user_ids,
                        "event_name": event_name,
                        "payload": payload,
                        "notify_email": "email" in channels,
                        "notify_sms": "sms" in channels,
                        "notify_telegram": "telegram" in channels,
                    },
                    headers={"X-Api-Key": self.internal_api_key},
                )

                if response.status_code == 200:
                    result = response.json()
                    successful = result.get("successful", 0)
                    failed = result.get("failed", 0)
                    return result

        except (httpx.TimeoutException, httpx.RequestError) as e:
            logger.warning(f"Notification service unavailable: {e}, queuing bulk")
            # Queue each notification
            for user_id in user_ids:
                await self.send(user_id, event_name, payload, channels=channels)

        return {
            "success": True,
            "total": len(user_ids),
            "successful": successful,
            "failed": failed,
            "source": "partial_or_queued",
        }
