"""Notification queue for graceful degradation when notification service is unavailable."""
import json
import logging
from typing import Any, Dict, Optional
from datetime import datetime, timedelta
import asyncio

logger = logging.getLogger(__name__)


class NotificationQueue:
    """In-memory queue for notifications with optional Redis backing."""

    def __init__(self, use_redis: bool = False, redis_client: Optional[Any] = None):
        """Initialize notification queue.

        Args:
            use_redis: Whether to use Redis for persistence
            redis_client: Redis client instance (optional)
        """
        self.use_redis = use_redis
        self.redis_client = redis_client
        self.in_memory_queue: list = []
        self.queue_key = "notification:queue"
        self.retry_key_prefix = "notification:retry:"

    async def enqueue(
        self,
        user_id: str,
        event_name: str,
        payload: Dict[str, Any],
        channels: list,
        priority: int = 1,
        max_retries: int = 5,
    ) -> str:
        """Add notification to queue.

        Args:
            user_id: User to notify
            event_name: Event/template name
            payload: Notification payload
            channels: Channels to send via (email, sms, telegram, etc)
            priority: Priority level (1-10, higher = more urgent)
            max_retries: Maximum retry attempts

        Returns:
            Queue ID for tracking
        """
        queue_id = f"{user_id}:{event_name}:{datetime.utcnow().timestamp()}"

        notification = {
            "id": queue_id,
            "user_id": user_id,
            "event_name": event_name,
            "payload": payload,
            "channels": channels,
            "priority": priority,
            "max_retries": max_retries,
            "attempt": 0,
            "created_at": datetime.utcnow().isoformat(),
            "next_retry_at": None,
            "status": "pending",
        }

        if self.use_redis and self.redis_client:
            try:
                await self.redis_client.lpush(
                    self.queue_key,
                    json.dumps(notification)
                )
                logger.info(f"Enqueued notification {queue_id} to Redis")
            except Exception as e:
                logger.error(f"Failed to enqueue to Redis: {e}, falling back to memory")
                self.in_memory_queue.append(notification)
        else:
            self.in_memory_queue.append(notification)
            logger.info(f"Enqueued notification {queue_id} to memory")

        return queue_id

    async def dequeue(self, batch_size: int = 10) -> list:
        """Get pending notifications from queue.

        Args:
            batch_size: Number of items to retrieve

        Returns:
            List of pending notifications
        """
        notifications = []

        if self.use_redis and self.redis_client:
            try:
                for _ in range(batch_size):
                    item = await self.redis_client.rpop(self.queue_key)
                    if item:
                        notifications.append(json.loads(item))
                    else:
                        break
            except Exception as e:
                logger.error(f"Failed to dequeue from Redis: {e}")
                notifications = self.in_memory_queue[:batch_size]
                self.in_memory_queue = self.in_memory_queue[batch_size:]
        else:
            notifications = self.in_memory_queue[:batch_size]
            self.in_memory_queue = self.in_memory_queue[batch_size:]

        return notifications

    async def mark_retry(
        self,
        queue_id: str,
        notification: Dict,
        backoff_seconds: int = 60
    ) -> None:
        """Mark notification for retry with exponential backoff.

        Args:
            queue_id: Notification ID
            notification: Notification data
            backoff_seconds: Seconds to wait before retry (will be exponentially increased)
        """
        notification["attempt"] += 1

        if notification["attempt"] >= notification["max_retries"]:
            logger.error(f"Max retries exceeded for notification {queue_id}")
            notification["status"] = "failed"
            return

        # Exponential backoff: 60s, 120s, 240s, 480s, 960s
        retry_backoff = backoff_seconds * (2 ** (notification["attempt"] - 1))
        notification["next_retry_at"] = (
            datetime.utcnow() + timedelta(seconds=retry_backoff)
        ).isoformat()
        notification["status"] = "pending_retry"

        if self.use_redis and self.redis_client:
            try:
                await self.redis_client.lpush(
                    self.queue_key,
                    json.dumps(notification)
                )
                logger.info(
                    f"Marked notification {queue_id} for retry "
                    f"(attempt {notification['attempt']})"
                )
            except Exception as e:
                logger.error(f"Failed to mark retry in Redis: {e}")
                self.in_memory_queue.append(notification)
        else:
            self.in_memory_queue.append(notification)

    async def get_queue_size(self) -> int:
        """Get current queue size."""
        if self.use_redis and self.redis_client:
            try:
                return await self.redis_client.llen(self.queue_key)
            except Exception:
                return len(self.in_memory_queue)
        return len(self.in_memory_queue)

    async def clear_queue(self) -> None:
        """Clear all pending notifications."""
        if self.use_redis and self.redis_client:
            try:
                await self.redis_client.delete(self.queue_key)
            except Exception as e:
                logger.error(f"Failed to clear Redis queue: {e}")
        self.in_memory_queue.clear()
        logger.info("Notification queue cleared")
