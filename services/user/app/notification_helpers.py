"""Notification helpers for user service."""
import logging
from typing import Optional, List
from fastapi import BackgroundTasks, Request

logger = logging.getLogger(__name__)


async def send_user_notification(
    request: Request,
    background_tasks: BackgroundTasks,
    user_id: str,
    event_name: str,
    payload: dict,
    channels: Optional[List[str]] = None,
) -> dict:
    """Send notification using GracefulNotificationClient."""
    client = request.app.state.notification_client

    if not client:
        return {"status": "disabled"}

    if channels is None:
        channels = ["email"]

    try:
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
        return {"status": "error"}
