"""Notification channel plugins."""
import logging
from typing import Any, Dict, Type

from .base import NotificationChannel

logger = logging.getLogger(__name__)

# Channel registry for plugin discovery
CHANNEL_REGISTRY: Dict[str, Type[NotificationChannel]] = {}


def register_channel(name: str, channel_class: Type[NotificationChannel]) -> None:
    """Register a notification channel.

    Args:
        name: Channel name (e.g., 'email', 'sms', 'telegram')
        channel_class: Channel class inheriting from NotificationChannel
    """
    CHANNEL_REGISTRY[name.lower()] = channel_class
    logger.info(f"Registered channel: {name}")


def get_channel(name: str, config: Dict[str, Any]) -> NotificationChannel:
    """Get a channel instance by name.

    Args:
        name: Channel name
        config: Channel configuration

    Returns:
        Channel instance

    Raises:
        ValueError: If channel not found
    """
    name_lower = name.lower()
    if name_lower not in CHANNEL_REGISTRY:
        raise ValueError(f"Channel '{name}' not registered. Available: {list(CHANNEL_REGISTRY.keys())}")

    channel_class = CHANNEL_REGISTRY[name_lower]
    return channel_class(config)


def list_channels() -> Dict[str, Type[NotificationChannel]]:
    """List all available channels.

    Returns:
        Dict mapping channel names to their classes
    """
    return CHANNEL_REGISTRY.copy()


# Import and register built-in channels
# These can be imported lazily to avoid circular imports
def load_builtin_channels() -> None:
    """Load built-in channel implementations."""
    try:
        from .email_channel import EmailChannel
        register_channel("email", EmailChannel)
    except ImportError as e:
        logger.warning(f"Could not load email channel: {e}")

    try:
        from .sms_channel import SMSChannel
        register_channel("sms", SMSChannel)
    except ImportError as e:
        logger.warning(f"Could not load SMS channel: {e}")

    try:
        from .telegram_channel import TelegramChannel
        register_channel("telegram", TelegramChannel)
    except ImportError as e:
        logger.warning(f"Could not load telegram channel: {e}")

    try:
        from .novu_channel import NovuChannel
        register_channel("novu", NovuChannel)
    except ImportError as e:
        logger.warning(f"Could not load novu channel: {e}")


# Load channels on import
load_builtin_channels()

__all__ = [
    "NotificationChannel",
    "register_channel",
    "get_channel",
    "list_channels",
    "CHANNEL_REGISTRY",
]
