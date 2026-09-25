"""Base plugin interface for notification channels."""
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
import logging

logger = logging.getLogger(__name__)


class NotificationChannel(ABC):
    """Base class for all notification channels."""

    def __init__(self, config: Dict[str, Any]):
        """Initialize channel with configuration.

        Args:
            config: Channel-specific configuration
        """
        self.config = config
        self.enabled = config.get("enabled", False)
        self.name = self.__class__.__name__

    @abstractmethod
    async def send(
        self,
        user_id: str,
        event_name: str,
        payload: Dict[str, Any],
        recipient: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Send notification via this channel.

        Args:
            user_id: User ID
            event_name: Event/template name
            payload: Notification payload
            recipient: Channel-specific recipient (email, phone, etc)
            **kwargs: Additional channel-specific parameters

        Returns:
            Response dict with status and metadata
        """
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        """Check if channel is healthy and ready.

        Returns:
            True if channel is available
        """
        pass

    async def validate_config(self) -> bool:
        """Validate channel configuration.

        Returns:
            True if configuration is valid
        """
        if not self.enabled:
            logger.info(f"Channel {self.name} is disabled")
            return True
        return True

    def __str__(self) -> str:
        return f"{self.name} (enabled={self.enabled})"
