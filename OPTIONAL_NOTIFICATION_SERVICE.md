# Optional Notification Service Implementation Guide

This document describes the implementation of an optional, gracefully-degrading notification service with a plugin-based channel architecture.

## Architecture Overview

### Core Principles

1. **Optional Service**: The notification service can be disabled without affecting core business logic
2. **Graceful Degradation**: When unavailable, notifications queue locally for later delivery
3. **Plugin Architecture**: Easy to add new channels (SMS, Telegram, Push notifications, etc.)
4. **Async Processing**: Non-blocking notification delivery
5. **Retry Logic**: Exponential backoff with configurable retry policies

### Component Structure

```
┌─────────────────────────────────────────────┐
│         Core Services                       │
│  (Event, User, Registration, Ticket)        │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│   GracefulNotificationClient                │
│   - Handles failures gracefully             │
│   - Queues notifications when service down  │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│   NotificationQueue (Redis/Memory)          │
│   - ENABLE_NOTIFICATIONS=true/false         │
│   - Persists across restarts                │
│   - Exponential backoff retry               │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│   Notification Service                      │
│   - Port 3009 (Optional, can be disabled)   │
│   - Plugin-based channels                   │
│   - Reads from queue                        │
└──────────────────┬──────────────────────────┘
                   │
        ┌──────────┼──────────┬──────────┬─────────┐
        ▼          ▼          ▼          ▼         ▼
    ┌──────┐  ┌──────┐  ┌─────────┐  ┌────┐  ┌────────┐
    │Email │  │  SMS │  │Telegram │  │Novu│  │  Push  │
    │ SMTP │  │Twilio│  │Bot API  │  │API │  │Firebase│
    └──────┘  └──────┘  └─────────┘  └────┘  └────────┘
```

## Configuration

### Environment Variables

```bash
# Enable/disable notifications system
ENABLE_NOTIFICATIONS=true

# Queue configuration
NOTIFICATION_QUEUE_TYPE=redis  # or 'memory' for in-process
REDIS_HOST=localhost
REDIS_PORT=6379

# Channel enablement
NOTIFICATION_CHANNELS=email,sms,telegram,novu

# Individual channel configuration
EMAIL_ENABLED=true
GMAIL_SMTP_USER=noreply@example.com
GMAIL_APP_PASSWORD=xxx

SMS_ENABLED=false
SMS_PROVIDER=twilio  # or aws-sns
TWILIO_ACCOUNT_SID=xxx
TWILIO_AUTH_TOKEN=xxx

TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=xxx

NOVU_ENABLED=true
NOVU_API_KEY=xxx
NOVU_BACKEND_URL=https://api.novu.co

# Retry configuration
NOTIFICATION_MAX_RETRIES=5
NOTIFICATION_RETRY_BACKOFF_SECONDS=60  # Initial backoff, then exponential
```

### Docker Compose Example

```yaml
notification-service:
  image: society-notification-service:latest
  environment:
    ENABLE_NOTIFICATIONS: "true"
    NOTIFICATION_QUEUE_TYPE: redis
    NOTIFICATION_CHANNELS: email,sms,telegram,novu
    EMAIL_ENABLED: "true"
    SMS_ENABLED: "false"
    TELEGRAM_ENABLED: "true"
    NOVU_ENABLED: "true"
  depends_on:
    - redis
    - postgres
  ports:
    - "3009:3009"
  networks:
    - society_net
```

## Integration Guide for Core Services

### 1. Update Service Configuration

Add to your service's `config.py`:

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # ... existing settings ...
    
    # Notification service
    enable_notifications: bool = True
    notification_service_url: str = "http://notification-service:3009"
    internal_api_key: str = ""
    notification_queue_type: str = "redis"  # or "memory"
```

### 2. Initialize Notification Client

In your service's `main.py`:

```python
from shared.notification_queue import NotificationQueue
from shared.notification_client_v2 import GracefulNotificationClient

# Initialize queue
queue = NotificationQueue(
    use_redis=True,
    redis_client=redis_client  # your Redis client
)

# Initialize client
notification_client = GracefulNotificationClient(
    notification_service_url=settings.notification_service_url,
    internal_api_key=settings.internal_api_key,
    enable_notifications=settings.enable_notifications,
    queue_handler=queue,
)
```

### 3. Send Notifications

In your routes:

```python
from fastapi import BackgroundTasks

@router.post("/events")
async def create_event(
    event: EventCreate,
    background_tasks: BackgroundTasks,
):
    # Create event
    db_event = await db.create_event(event)
    
    # Queue notification (async, won't block response)
    background_tasks.add_task(
        notification_client.send,
        user_id=event.organizer_id,
        event_name="event_created",
        payload={
            "event_id": db_event.id,
            "event_name": db_event.name,
            "date": db_event.date.isoformat(),
        },
        channels=["email", "telegram"],
    )
    
    return db_event
```

### 4. Bulk Notifications

```python
# Send to multiple users
await notification_client.send_bulk(
    user_ids=recipient_ids,
    event_name="event_reminder",
    payload={"event_id": event_id},
    channels=["email"],
)
```

## Plugin Architecture

### Creating a Custom Channel

1. Create a new file in `services/notification/app/channels/`:

```python
# services/notification/app/channels/slack_channel.py
from typing import Any, Dict, Optional
from .base import NotificationChannel

class SlackChannel(NotificationChannel):
    """Slack notification channel."""
    
    async def send(
        self,
        user_id: str,
        event_name: str,
        payload: Dict[str, Any],
        recipient: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        # Implementation
        pass
    
    async def health_check(self) -> bool:
        # Implementation
        pass
```

2. Register in `services/notification/app/channels/__init__.py`:

```python
def load_builtin_channels() -> None:
    # ... existing imports ...
    
    try:
        from .slack_channel import SlackChannel
        register_channel("slack", SlackChannel)
    except ImportError as e:
        logger.warning(f"Could not load slack channel: {e}")
```

3. Enable via environment variable:

```bash
NOTIFICATION_CHANNELS=email,sms,telegram,novu,slack
SLACK_ENABLED=true
SLACK_WEBHOOK_URL=https://hooks.slack.com/...
```

## Graceful Degradation Scenarios

### Scenario 1: Notification Service is Down

1. Core service tries to send notification
2. Service is unreachable (connection refused)
3. Notification is automatically queued locally
4. Core service returns success to client (notification queued for later)
5. When notification service restarts, it processes the queue
6. Notifications are eventually delivered with automatic retries

### Scenario 2: Notifications are Disabled

```bash
ENABLE_NOTIFICATIONS=false
```

1. All `notification_client.send()` calls return immediately
2. No queue entries are created
3. Core services work unchanged
4. Useful for development/testing

### Scenario 3: Specific Channel Fails

1. Email send fails
2. SMS channel is enabled, tries sending instead
3. If all channels fail, notification is queued for retry
4. Next retry attempts all enabled channels again

### Scenario 4: Transient Network Error

1. Notification request times out
2. Automatic retry with exponential backoff
3. Initial wait: 60s
4. Second retry: 120s
5. Third retry: 240s
6. Up to 5 retries by default

## Monitoring & Health Checks

### Notification Service Health Endpoint

```bash
curl http://localhost:8080/api/notifications/health
```

Response:
```json
{
  "status": "ok",
  "service": "notification-service",
  "environment": "production",
  "channels": {
    "email": {"enabled": true, "healthy": true},
    "sms": {"enabled": false},
    "telegram": {"enabled": true, "healthy": true},
    "novu": {"enabled": true, "healthy": false, "error": "Invalid API key"}
  },
  "queue_size": 42
}
```

### Queue Monitoring

```python
# Get queue size
queue_size = await notification_queue.get_queue_size()
print(f"Pending notifications: {queue_size}")

# Clear stuck notifications
await notification_queue.clear_queue()
```

## Migration Steps for Existing Services

### For each core service (event, user, registration, ticket, payment):

1. **Add dependencies**:
   ```bash
   pip install httpx redis
   ```

2. **Update configuration** (`services/<name>/app/config.py`)

3. **Initialize client** in service startup

4. **Replace existing notification calls**:
   
   Before:
   ```python
   try:
       await send_to_notification_service(...)
   except Exception:
       logger.error("Notification failed")
   ```
   
   After:
   ```python
   await notification_client.send(...)  # Auto-handles failures
   ```

5. **Test graceful degradation**:
   ```bash
   # Stop notification service
   docker compose down notification-service
   
   # Trigger events that send notifications
   # Verify they're queued
   
   # Restart notification service
   docker compose up -d notification-service
   
   # Verify queued notifications are delivered
   ```

## Troubleshooting

### Notifications not being delivered

1. Check if service is enabled: `ENABLE_NOTIFICATIONS=true`
2. Check queue size: `curl http://localhost:8080/api/notifications/health`
3. Check logs: `make logs-notification`
4. Verify channels are enabled for the event
5. Check channel-specific credentials (API keys, SMTP, etc.)

### Queue growing unbounded

1. Notification service is down
2. All channels failing
3. Retry backoff too long

Solution: Fix channel issues, consider increasing `NOTIFICATION_MAX_RETRIES` or adjusting backoff times.

### High latency in core services

1. Notification sending is not truly async
2. Solution: Always use `background_tasks.add_task()` or async task queue

## Future Enhancements

1. **Dead Letter Queue**: Permanently failed notifications stored separately
2. **Webhook Support**: Notify core services of delivery status
3. **Templating Engine**: Render emails/SMS from templates
4. **User Preferences**: Let users choose notification channels
5. **Analytics**: Track delivery rates per channel
6. **Rate Limiting**: Prevent notification storms
7. **Scheduled Notifications**: Send at specific times
8. **Templates as Plugins**: Custom template engines per channel

## References

- **Architecture Diagram**: See OPTIONAL_NOTIFICATION_SERVICE.md (architecture section)
- **API Reference**: `/api/notifications/docs`
- **Plugin Interface**: `services/notification/app/channels/base.py`
- **Client Library**: `services/shared/notification_client_v2.py`
- **Queue System**: `services/shared/notification_queue.py`
