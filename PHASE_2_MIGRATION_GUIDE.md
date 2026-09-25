# Phase 2: Core Service Integration Guide

This guide shows how to integrate the optional notification service into existing core services using `GracefulNotificationClient` for resilient notification delivery.

## Overview

Each core service (event, user, registration, ticket, payment) needs to be updated to:
1. Initialize `NotificationQueue` and `GracefulNotificationClient`
2. Replace existing notification calls with graceful alternatives
3. Test graceful degradation scenarios

## Step 1: Update Service Configuration

### In `services/<name>/app/config.py`

Already done ✓ (notification settings added to all services)

Verify these settings exist:
```python
enable_notifications: bool = True
notification_service_url: str = "http://notification-service:3009"
notification_queue_type: str = "redis"
```

### In `services/<name>/.env.example`

Already done ✓ (environment variables added)

Verify these lines exist:
```bash
ENABLE_NOTIFICATIONS=true
NOTIFICATION_QUEUE_TYPE=redis
```

## Step 2: Initialize Queue and Client in Service Main File

### Pattern for `services/<name>/app/main.py`

Add imports at the top:
```python
from shared.notification_queue import NotificationQueue
from shared.notification_client_v2 import GracefulNotificationClient
import redis.asyncio as aioredis
```

Create global instances:
```python
notification_queue: NotificationQueue = None
notification_client: GracefulNotificationClient = None
```

Update the app startup to initialize:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    global notification_queue, notification_client
    
    logger.info("Starting event-service")
    
    # Initialize notification queue if enabled
    if settings.enable_notifications:
        try:
            if settings.notification_queue_type == "redis":
                redis_client = aioredis.from_url(
                    f"redis://{settings.redis_host}:{settings.redis_port}/0",
                    encoding="utf8",
                    decode_responses=True,
                )
                notification_queue = NotificationQueue(
                    use_redis=True,
                    redis_client=redis_client,
                )
                logger.info("Redis queue initialized for notifications")
            else:
                notification_queue = NotificationQueue(use_redis=False)
                logger.info("In-memory queue initialized for notifications")
        except Exception as e:
            logger.warning(f"Failed to initialize notification queue: {e}")
            notification_queue = NotificationQueue(use_redis=False)
    
    # Initialize graceful notification client
    if settings.enable_notifications and notification_queue:
        notification_client = GracefulNotificationClient(
            notification_service_url=settings.notification_service_url,
            internal_api_key=settings.internal_api_key,
            enable_notifications=True,
            queue_handler=notification_queue,
        )
        logger.info("Graceful notification client initialized")
    
    yield
    
    logger.info("Shutting down event-service")
```

## Step 3: Replace Existing Notification Calls

### Before: Direct HTTP Call (Blocking)

```python
@router.post("/events")
async def create_event(event: EventCreate):
    db_event = await db.create_event(event)
    
    # OLD: Direct call - blocks if service is down
    try:
        await notify_event_created(db_event)
    except Exception as e:
        logger.error(f"Notification failed: {e}")
    
    return db_event
```

### After: Using Background Tasks (Non-blocking)

```python
from fastapi import BackgroundTasks

@router.post("/events")
async def create_event(
    event: EventCreate,
    background_tasks: BackgroundTasks,
):
    db_event = await db.create_event(event)
    
    # NEW: Queue in background, returns immediately
    if notification_client:
        background_tasks.add_task(
            notification_client.send,
            user_id=event.organizer_id,
            event_name="event_created",
            payload={
                "event_id": db_event.id,
                "event_name": db_event.name,
                "date": db_event.date.isoformat(),
                "organizer_name": event.organizer_name,
            },
            channels=["email", "telegram"],
        )
    
    return db_event
```

Key differences:
- `background_tasks.add_task()` queues async execution
- Returns to client immediately (fast response)
- If notification service is down, notification is queued locally
- When service recovers, queued notifications are retried

## Step 4: Integration Patterns

### Pattern 1: Event Notifications

Used for: event creation, updates, cancellations

```python
background_tasks.add_task(
    notification_client.send,
    user_id=event.created_by,
    event_name="event_created",
    payload={
        "event_id": event.id,
        "event_name": event.name,
        "date": event.date.isoformat(),
        "location": event.location,
    },
    channels=["email"],  # Choose channels
)
```

### Pattern 2: Bulk Notifications

Used for: mass notifications, reminders, announcements

```python
# Notify all residents about upcoming event
resident_ids = await db.get_residents_for_society(society_id)

if notification_client:
    await notification_client.send_bulk(
        user_ids=resident_ids,
        event_name="event_reminder",
        payload={
            "event_id": event.id,
            "days_until": 3,
            "event_name": event.name,
        },
        channels=["email", "telegram"],
    )
```

### Pattern 3: Payment/Refund Notifications

Used for: payment confirmations, refund approvals, transaction status

```python
background_tasks.add_task(
    notification_client.send,
    user_id=registration.user_id,
    event_name="payment_approved",
    payload={
        "registration_id": registration.id,
        "amount": registration.amount,
        "currency": "INR",
        "transaction_id": payment.id,
    },
    channels=["email", "sms"],
)
```

### Pattern 4: Conditional Channels

Send to different channels based on user preference or event type:

```python
user = await db.get_user(user_id)
channels = []

if user.prefers_email:
    channels.append("email")
if user.telegram_chat_id:
    channels.append("telegram")
if user.phone_number:
    channels.append("sms")

if channels:  # Only send if at least one channel available
    background_tasks.add_task(
        notification_client.send,
        user_id=user_id,
        event_name="registration_confirmed",
        payload={"registration_id": registration.id},
        channels=channels,
    )
```

## Step 5: Testing Graceful Degradation

### Test 1: Service Down

```bash
# Stop the notification service
docker compose down notification-service

# Trigger an action that sends notification (e.g., create event)
# Note: Response still succeeds, notification is queued

# Check queue size
curl http://localhost:3009/api/notifications/queue/status \
  -H "X-Api-Key: your_internal_api_key"

# Response shows queued notifications:
# {"queue_enabled": true, "size": 5, "type": "redis"}

# Restart the notification service
docker compose up -d notification-service

# Notifications are automatically retried from queue
# Check logs: docker compose logs notification-service
```

### Test 2: Notifications Disabled

```bash
# In service .env
ENABLE_NOTIFICATIONS=false

# Restart service
docker compose restart event-service

# Trigger actions - no notifications sent, no queue entries
# Service operates normally, just without notifications
```

### Test 3: Channel Failure

```bash
# In notification-service .env, disable a channel
EMAIL_ENABLED=false

# Restart service
docker compose restart notification-service

# Notifications still work, using remaining channels
# Failed notifications retry via other channels
```

## Step 6: Health and Monitoring

### Add Health Check to Service

```python
@router.get("/health")
async def health_check():
    """Health check with notification status."""
    notification_status = {
        "enabled": settings.enable_notifications,
        "service_url": settings.notification_service_url,
    }
    
    if notification_queue:
        try:
            queue_size = await notification_queue.get_queue_size()
            notification_status["queue_size"] = queue_size
            notification_status["queue_healthy"] = queue_size < 1000
        except Exception as e:
            notification_status["queue_error"] = str(e)
    
    return {
        "status": "ok",
        "service": "event-service",
        "notifications": notification_status,
    }
```

### Monitor Queue Size

```bash
# Check queue in each service
for service in event user registration ticket payment; do
  echo "=== $service ==="
  docker compose exec $service curl -s http://localhost:3009/api/notifications/queue/status
done
```

## Step 7: Migration Checklist

For each core service (event, user, registration, ticket, payment):

- [ ] Verify config.py has notification settings
- [ ] Verify .env.example has ENABLE_NOTIFICATIONS
- [ ] Add imports: NotificationQueue, GracefulNotificationClient
- [ ] Initialize queue and client in lifespan context manager
- [ ] Identify all notification calls in the service
- [ ] Wrap each call with `background_tasks.add_task()`
- [ ] Test with service running
- [ ] Test with notification-service stopped
- [ ] Test with notifications disabled
- [ ] Verify queue is cleared after service recovery
- [ ] Update service health check
- [ ] Document notification events sent by service

## Service Integration Status

### ✓ Complete (Configuration)
- [x] event-service
- [x] user-service
- [x] registration-service
- [x] ticket-service
- [x] payment-service
- [x] notification-service

### TODO (Code Integration)
- [ ] event-service: Replace notification calls
- [ ] registration-service: Replace payment notification calls
- [ ] ticket-service: Replace ticket delivery notifications
- [ ] payment-service: Replace refund notification calls
- [ ] user-service: Replace account notification calls

## Common Issues and Solutions

### Issue: Queue keeps growing

**Cause**: Notification service is down or all channels failing

**Solution**:
1. Check notification service health: `docker compose logs notification-service`
2. Check channel configuration: `curl http://localhost:3009/api/notifications/config`
3. Fix underlying issue (restart service, update credentials, etc.)
4. Manually clear queue if needed: `curl -X POST http://localhost:3009/api/notifications/queue/clear`

### Issue: High latency in core services

**Cause**: Notification sending is blocking the response

**Solution**:
1. Verify using `background_tasks.add_task()` NOT `await notification_client.send()`
2. Check Redis/queue performance
3. Monitor notification service CPU/memory

### Issue: Notifications not received after service recovery

**Cause**: Queue processor not running or max retries exceeded

**Solution**:
1. Check queue processor logs
2. Verify queue size: `curl http://localhost:3009/api/notifications/queue/status`
3. Check retry configuration: max_retries, backoff_seconds
4. Manually clear and resend if needed

## Next Steps

1. **Phase 3**: Implement queue processing worker in notification-service
2. **Phase 4**: Add webhook support for delivery confirmations
3. **Phase 5**: Add user notification preferences
4. **Phase 6**: Add rate limiting and throttling
5. **Phase 7**: Add analytics and delivery metrics dashboard

## References

- [OPTIONAL_NOTIFICATION_SERVICE.md](OPTIONAL_NOTIFICATION_SERVICE.md) - Architecture & configuration
- [services/shared/NOTIFICATION_CLIENT_USAGE.md](services/shared/NOTIFICATION_CLIENT_USAGE.md) - API reference
- [services/shared/notification_client_v2.py](services/shared/notification_client_v2.py) - Implementation
- [services/shared/notification_queue.py](services/shared/notification_queue.py) - Queue system
