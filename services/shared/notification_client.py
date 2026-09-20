"""Client for calling the Notification Service from other services."""
import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger(__name__)


class NotificationClient:
    """HTTP client for interacting with notification-service."""

    def __init__(
        self,
        base_url: str = "http://notification-service:3009",
        api_key: str = "",
        timeout: float = 30.0,
    ):
        """
        Initialize notification client.

        Args:
            base_url: Base URL of notification-service (default: http://notification-service:3009)
            api_key: Internal API key for authentication
            timeout: Request timeout in seconds
        """
        self.base_url = base_url
        self.api_key = api_key
        self.timeout = timeout
        self.headers = {"X-Api-Key": api_key} if api_key else {}

    async def send(
        self,
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
        Send a unified notification.

        Args:
            user_id: User UUID
            event_name: Novu event/template name
            payload: Template payload
            user_phone: Phone number for SMS/Telegram
            user_email: Email for email notification
            legacy_message: Fallback message text
            notify_sms: Send SMS notification
            notify_email: Send email notification
            notify_telegram: Send Telegram notification
            tags: Optional tags for tracking

        Returns:
            Response dict with source, success, id, and data
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/notifications/send",
                    json={
                        "user_id": user_id,
                        "event_name": event_name,
                        "payload": payload,
                        "user_phone": user_phone,
                        "user_email": user_email,
                        "legacy_message": legacy_message,
                        "notify_sms": notify_sms,
                        "notify_email": notify_email,
                        "notify_telegram": notify_telegram,
                        "tags": tags,
                    },
                    headers=self.headers,
                )

                if response.status_code < 300:
                    return response.json()
                else:
                    logger.error(
                        f"Notification service error: {response.status_code}",
                        extra={"response": response.text},
                    )
                    return {"success": False, "source": "none", "error": response.text}
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to notification-service: {e}")
            return {"success": False, "source": "none", "error": str(e)}
        except Exception as e:
            logger.error(f"Error sending notification: {e}", exc_info=True)
            return {"success": False, "source": "none", "error": str(e)}

    async def send_bulk(
        self,
        user_ids: list,
        event_name: str,
        payload: Dict[str, Any],
        legacy_message: Optional[str] = None,
        notify_sms: bool = True,
        notify_email: bool = True,
        notify_telegram: bool = True,
    ) -> Dict[str, Any]:
        """
        Send notifications to multiple users.

        Args:
            user_ids: List of user UUIDs
            event_name: Novu event/template name
            payload: Template payload
            legacy_message: Fallback message text
            notify_sms: Send SMS notification
            notify_email: Send email notification
            notify_telegram: Send Telegram notification

        Returns:
            Response dict with total, successful, failed, and results
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/notifications/bulk",
                    json={
                        "user_ids": user_ids,
                        "event_name": event_name,
                        "payload": payload,
                        "legacy_message": legacy_message,
                        "notify_sms": notify_sms,
                        "notify_email": notify_email,
                        "notify_telegram": notify_telegram,
                    },
                    headers=self.headers,
                )

                if response.status_code < 300:
                    return response.json()
                else:
                    logger.error(f"Bulk notification error: {response.status_code}")
                    return {
                        "total": len(user_ids),
                        "successful": 0,
                        "failed": len(user_ids),
                        "results": [],
                    }
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to notification-service: {e}")
            return {
                "total": len(user_ids),
                "successful": 0,
                "failed": len(user_ids),
                "results": [],
            }

    async def send_in_app(
        self,
        user_id: str,
        type_: str,
        title: str,
        message: str,
        related_id: Optional[str] = None,
        event_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Record an in-app notification.

        Args:
            user_id: User UUID
            type_: Notification type (e.g., "payment_approved")
            title: Notification title
            message: Notification message
            related_id: Optional related resource ID
            event_id: Optional event ID

        Returns:
            Response dict with notification details
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.base_url}/api/notifications/in-app",
                    json={
                        "user_id": user_id,
                        "type": type_,
                        "title": title,
                        "message": message,
                        "related_id": related_id,
                        "event_id": event_id,
                    },
                    headers=self.headers,
                )

                if response.status_code < 300:
                    return response.json()
                else:
                    logger.error(f"In-app notification error: {response.status_code}")
                    return {"success": False, "error": response.text}
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to notification-service: {e}")
            return {"success": False, "error": str(e)}

    async def get_status(self, notification_id: str) -> Dict[str, Any]:
        """
        Get the status of a sent notification.

        Args:
            notification_id: Notification ID from send response

        Returns:
            Response dict with delivery status
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/notifications/status/{notification_id}",
                    headers=self.headers,
                )

                if response.status_code < 300:
                    return response.json()
                else:
                    logger.error(f"Status check error: {response.status_code}")
                    return {"error": response.text}
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to notification-service: {e}")
            return {"error": str(e)}

    async def get_config(self) -> Dict[str, Any]:
        """
        Get current notification service configuration.

        Returns:
            Config dict showing enabled channels and strategy
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{self.base_url}/api/notifications/config",
                    headers=self.headers,
                )

                if response.status_code < 300:
                    return response.json()
                else:
                    logger.error(f"Config fetch error: {response.status_code}")
                    return {}
        except httpx.RequestError as e:
            logger.error(f"Failed to connect to notification-service: {e}")
            return {}


# Global client instance
_client: Optional[NotificationClient] = None


def get_notification_client(
    base_url: str = "http://notification-service:3009",
    api_key: str = "",
) -> NotificationClient:
    """
    Get or create a global notification client.

    Args:
        base_url: Base URL of notification-service
        api_key: Internal API key

    Returns:
        NotificationClient instance
    """
    global _client
    if _client is None:
        _client = NotificationClient(base_url=base_url, api_key=api_key)
    return _client


# Convenience function for quick sends
async def send_notification(
    user_id: str,
    event_name: str,
    payload: Dict[str, Any],
    user_phone: Optional[str] = None,
    user_email: Optional[str] = None,
    legacy_message: Optional[str] = None,
    api_key: str = "",
) -> Dict[str, Any]:
    """
    Send a notification using the global client.

    Args:
        user_id: User UUID
        event_name: Novu event/template name
        payload: Template payload
        user_phone: Phone number for SMS/Telegram
        user_email: Email for email notification
        legacy_message: Fallback message text
        api_key: Internal API key (optional, uses global if not provided)

    Returns:
        Response dict with source, success, id, and data
    """
    client = get_notification_client(api_key=api_key)
    return await client.send(
        user_id=user_id,
        event_name=event_name,
        payload=payload,
        user_phone=user_phone,
        user_email=user_email,
        legacy_message=legacy_message,
    )
