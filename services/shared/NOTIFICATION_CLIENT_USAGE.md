# GracefulNotificationClient Usage Guide

The `GracefulNotificationClient` provides a fault-tolerant wrapper around the notification service, automatically queuing notifications when the service is unavailable.

## Quick Start

### 1. Import and Initialize

```python
from shared.notification_queue import NotificationQueue
from shared.notification_client_v2 import GracefulNotificationClient
import redis.asyncio as aioredis

# Initialize queue (Redis with in-memory fallback)
redis_client = aioredis.from_url(
    f"redis://{settings.redis_host}:{settings.redis_port}/0",
    encoding="utf8",
    decode_responses=True,
)
queue = NotificationQueue(use_redis=True, redis_client=redis_client)

# Initialize client
notification_client = GracefulNotificationClient(
    notification_service_url=settings.notification_service_url,
    internal_api_key=settings.internal_api_key,
    enable_notifications=settings.enable_notifications,
    queue_handler=queue,
)
```

### 2. Send Notifications (Async, Non-blocking)

```python
from fastapi import BackgroundTasks

@router.post("/events")
async def create_event(
    event: EventCreate,
    background_tasks: BackgroundTasks,
):
    # Create event
    db_event = await db.create_event(event)
    
    # Queue notification in background (doesn't block response)
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

### 3. Send Bulk Notifications

```python
# Send to multiple users at once
await notification_client.send_bulk(
    user_ids=recipient_ids,
    event_name="event_reminder",
    payload={"event_id": event_id},
    channels=["email"],
)
```

## Response Handling

The client returns a dictionary with `status` indicating what happened:

```python
result = await notification_client.send(
    user_id="user-123",
    event_name="event_created",
    payload={"event_id": "event-456"},
)

# result['status'] can be:
# - 'sent': Delivered immediately to notification service
# - 'queued': Service unavailable, notification queued for later
# - 'disabled': Notifications are disabled (ENABLE_NOTIFICATIONS=false)
```

## Configuration

Add to your service's `.env`:

```bash
# Enable/disable notifications
ENABLE_NOTIFICATIONS=true

# Notification service endpoint
NOTIFICATION_SERVICE_URL=http://notification-service:3009

# Queue type (redis or memory)
NOTIFICATION_QUEUE_TYPE=redis

# Redis configuration
REDIS_HOST=redis
REDIS_PORT=6379
```

Add to your service's `config.py`:

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # ... existing settings ...
    
    enable_notifications: bool = True
    notification_service_url: str = "http://notification-service:3009"
    notification_queue_type: str = "redis"
```

## Error Scenarios Handled Automatically

### Scenario 1: Notification Service is Down
- Core service tries to send
- Connection fails (connection refused)
- Notification automatically queued locally
- Core service returns success to client
- Queue retries with exponential backoff when service restarts

### Scenario 2: Notifications Disabled
- `ENABLE_NOTIFICATIONS=false`
- All `send()` calls return immediately
- No queue entries created
- Useful for testing/development

### Scenario 3: Timeout During Send
- Notification request times out
- Automatically retried with exponential backoff
- Initial: 60s, 120s, 240s, 480s, 960s (configurable)

## Graceful Degradation Flow

```
Core Service
    ↓
GracefulNotificationClient
    ↓ (attempt to send)
    ├─ Success → Return immediately
    └─ Failure → Queue locally
        ↓
    Local Queue (Redis/Memory)
        ↓ (periodic processing)
    Notification Service (when available)
        ↓
    Delivery Channels (Email, SMS, Telegram, Novu)
```

## Health Checks

Check if notifications are working:

```bash
# Get overall health
curl http://notification-service:3009/health

# Get queue status
curl http://localhost:3009/api/notifications/queue/status \
  -H "X-Api-Key: your_internal_api_key"

# Get channel status
curl http://localhost:3009/api/notifications/config \
  -H "X-Api-Key: your_internal_api_key"
```

## When NOT to Use

- **Critical business notifications**: Always call notification service directly for high-priority alerts
- **Real-time synchronous delivery**: Don't use async if you need immediate confirmation in the same request
- **Analytics/tracking**: Queue model is "eventual consistency" — not suitable for immediate data visibility

## Advanced Usage

### Custom Channel Selection

```python
# Send only via email (skip Telegram if available)
await notification_client.send(
    user_id="user-123",
    event_name="event_created",
    payload={"event_id": "event-456"},
    channels=["email"],  # Only use these channels
)
```

### Override Recipients

```python
# Send to different email/phone than user's configured
await notification_client.send(
    user_id="user-123",
    event_name="event_reminder",
    payload={"event_id": "event-456"},
    user_email="alternate@example.com",
    user_phone="+91-9999999999",
)
```

### Disable Notifications Temporarily

```bash
# In .env
ENABLE_NOTIFICATIONS=false

# All send() calls become no-ops
# No queue entries created
```

## Troubleshooting

### Notifications not being delivered
1. Check `ENABLE_NOTIFICATIONS=true` in .env
2. Check queue size: `curl http://localhost:3009/api/notifications/queue/status`
3. Check logs: `docker compose logs notification-service`
4. Verify channel credentials (API keys, SMTP settings)
5. Check Keycloak auth if using OAuth2

### Queue growing unbounded
1. Notification service is down
2. All channels failing
3. Check Redis connection
4. Clear stuck notifications: `curl -X POST http://localhost:3009/api/notifications/queue/clear`

### High latency in core services
1. Ensure `background_tasks.add_task()` is used (don't await)
2. Check Redis performance
3. Monitor notification service CPU/memory
