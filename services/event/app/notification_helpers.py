"""Notification helpers for event service."""
import logging
from typing import Optional, List
from fastapi import BackgroundTasks, Request

logger = logging.getLogger(__name__)


async def send_event_notification(
    request: Request,
    background_tasks: BackgroundTasks,
    user_id: str,
    event_name: str,
    payload: dict,
    channels: Optional[List[str]] = None,
) -> dict:
    """
    Send notification using GracefulNotificationClient.

    This queues the notification in the background and returns immediately.
    If the notification service is unavailable, the notification is queued locally
    and will be delivered when the service recovers.

    Args:
        request: FastAPI request object (has app.state.notification_client)
        background_tasks: FastAPI BackgroundTasks for async execution
        user_id: User ID to send notification to
        event_name: Notification event name (e.g., 'event_created')
        payload: Event data payload
        channels: List of channels to use (e.g., ['email', 'telegram'])

    Returns:
        dict with status ('sent', 'queued', or 'disabled')
    """
    client = request.app.state.notification_client

    if not client:
        logger.warning("Notification client not initialized")
        return {"status": "disabled", "reason": "client_not_initialized"}

    if channels is None:
        channels = ["email"]  # Default channel

    try:
        # Queue in background - don't block the response
        background_tasks.add_task(
            client.send,
            user_id=user_id,
            event_name=event_name,
            payload=payload,
            channels=channels,
        )
        return {"status": "queued", "user_id": user_id}
    except Exception as e:
        logger.error(f"Error queueing notification: {e}")
        return {"status": "error", "reason": str(e)}


async def send_bulk_event_notification(
    request: Request,
    user_ids: List[str],
    event_name: str,
    payload: dict,
    channels: Optional[List[str]] = None,
) -> dict:
    """
    Send notification to multiple users.

    Args:
        request: FastAPI request object (has app.state.notification_client)
        user_ids: List of user IDs
        event_name: Notification event name
        payload: Event data payload
        channels: List of channels to use

    Returns:
        dict with count of users notified
    """
    client = request.app.state.notification_client

    if not client or not user_ids:
        return {"status": "skipped", "count": 0}

    if channels is None:
        channels = ["email"]

    try:
        # Send bulk notifications (async)
        await client.send_bulk(
            user_ids=user_ids,
            event_name=event_name,
            payload=payload,
            channels=channels,
        )
        return {"status": "queued", "count": len(user_ids)}
    except Exception as e:
        logger.error(f"Error sending bulk notifications: {e}")
        return {"status": "error", "reason": str(e)}
