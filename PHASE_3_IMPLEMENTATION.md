# Phase 3: Queue Processing & Service Integration

**Status**: In Progress  
**Date Started**: 2026-09-25

## What Was Accomplished

### ✅ Event Service Integration

The event service now demonstrates the full integration pattern:

#### 1. Notification Initialization in `services/event/app/main.py`
```python
# Added to lifespan context manager:
- Initialize NotificationQueue (Redis or in-memory)
- Initialize GracefulNotificationClient
- Store in app.state for route access
- Graceful error handling if initialization fails
```

#### 2. Notification Helpers in `services/event/app/notification_helpers.py`
```python
async def send_event_notification(request, background_tasks, user_id, event_name, payload)
  - Sends notification without blocking response
  - Automatically queues if service unavailable
  - Supports multiple channels

async def send_bulk_event_notification(request, user_ids, event_name, payload)
  - Send to multiple users at once
```

#### 3. How to Use in Routes
```python
from app.notification_helpers import send_event_notification

@router.post("/events")
async def create_event(
    event: EventCreate,
    request: Request,
    background_tasks: BackgroundTasks,
):
    db_event = await db.create_event(event)
    
    # Send notification (async, non-blocking)
    await send_event_notification(
        request=request,
        background_tasks=background_tasks,
        user_id=event.organizer_id,
        event_name="event_created",
        payload={
            "event_id": db_event.id,
            "event_name": db_event.name,
        },
        channels=["email", "telegram"],
    )
    
    return db_event
```

### ✅ Queue Processor Implementation

The notification service now has a working queue processor:

#### Features
- Processes up to 10 notifications per cycle (every 30 seconds)
- Automatic retry with exponential backoff on failure
- Marks notifications for retry if delivery fails
- Logs delivery success and failures
- Graceful error handling

#### Implementation in `notification-service/app/main.py`
```python
async def process_queue_periodically():
    """Background task to process queued notifications."""
    - Check queue size
    - Dequeue notifications
    - Attempt delivery via send_unified_notification()
    - Mark for retry on failure
    - Sleep 30s between cycles
```

### ✅ Notification Helpers for All Services

Created helper files for:
- `services/event/app/notification_helpers.py` ✓
- `services/user/app/notification_helpers.py` ✓
- `services/registration/app/notification_helpers.py` ✓
- `services/ticket/app/notification_helpers.py` ✓
- `services/payment/app/notification_helpers.py` ✓

Each provides consistent API:
```python
send_<service>_notification(request, background_tasks, user_id, event_name, payload)
```

## Architecture Diagram

```
Core Service Route Handler
    ↓
send_<service>_notification()
    ↓
background_tasks.add_task()
    ↓ (async)
GracefulNotificationClient.send()
    ├─ Success → Log and return
    ├─ Timeout/Error → Auto-queue locally
    └─ Client returns immediately (non-blocking)
    
NotificationQueue (Redis/Memory)
    ↓ (periodic processing - every 30s)
Queue Processor in notification-service
    ├─ Dequeue notification
    ├─ Attempt delivery via send_unified_notification()
    ├─ Success → Log and remove from queue
    └─ Failure → Mark for retry with exponential backoff
```

## How Graceful Degradation Works

### Scenario 1: Normal Operation
```
1. Event service receives event creation request
2. Calls send_event_notification()
3. Background task calls GracefulNotificationClient.send()
4. Client connects to notification-service:3009
5. Notification service processes and delivers
6. Returns immediately (user gets response)
```

### Scenario 2: Notification Service Down
```
1. Event service receives event creation request
2. Calls send_event_notification()
3. Background task calls GracefulNotificationClient.send()
4. Client tries to connect to notification-service:3009 (fails)
5. Client automatically queues notification locally (Redis/memory)
6. Returns success (user gets response)
7. When service recovers:
   - Queue processor wakes up
   - Dequeues notifications
   - Attempts delivery
   - Retries with exponential backoff
```

### Scenario 3: Notifications Disabled
```
1. Event service has ENABLE_NOTIFICATIONS=false
2. Calls send_event_notification()
3. GracefulNotificationClient.send() returns immediately
4. No queue entries created
5. No notification service calls
6. Service works normally without notifications
```

## Integration Checklist for Each Service

### For event-service
- [x] Import NotificationQueue and GracefulNotificationClient in main.py
- [x] Initialize in lifespan context manager
- [x] Store in app.state
- [x] Create notification_helpers.py
- [ ] Integrate into existing routes (e.g., POST /events)
- [ ] Test graceful degradation
- [ ] Update CHANGELOG

### For user-service
- [ ] Import NotificationQueue and GracefulNotificationClient in main.py
- [ ] Initialize in lifespan context manager
- [ ] Store in app.state
- [x] Create notification_helpers.py
- [ ] Integrate into routes (user updates, roles, etc.)
- [ ] Test graceful degradation

### For registration-service
- [ ] Import NotificationQueue and GracefulNotificationClient in main.py
- [ ] Initialize in lifespan context manager
- [ ] Store in app.state
- [x] Create notification_helpers.py
- [ ] Integrate into routes (registration confirmation, payment status)
- [ ] Test graceful degradation

### For ticket-service
- [ ] Import NotificationQueue and GracefulNotificationClient in main.py
- [ ] Initialize in lifespan context manager
- [ ] Store in app.state
- [x] Create notification_helpers.py
- [ ] Integrate into routes (ticket issuance, QR delivery)
- [ ] Test graceful degradation

### For payment-service
- [ ] Import NotificationQueue and GracefulNotificationClient in main.py
- [ ] Initialize in lifespan context manager
- [ ] Store in app.state
- [x] Create notification_helpers.py
- [ ] Integrate into routes (payment verification, refund approval)
- [ ] Test graceful degradation

## Testing Graceful Degradation

### Test 1: Service Down
```bash
# In terminal 1: Start main stack and notification service
cd ~/my-society && make up
cd ~/notification-service && docker compose up -d

# In terminal 2: Stop notification service
docker compose down

# Trigger event creation (should queue notification)
curl -X POST http://localhost:8080/api/events/...

# Check queue
curl http://localhost:3009/api/notifications/queue/status \
  -H "X-Api-Key: your_api_key"

# Response shows queued notifications
{"queue_enabled": true, "size": 1, "type": "redis"}

# Restart notification service
docker compose up -d

# Queue processor should deliver queued notification
docker compose logs -f notification-service | grep "Queued notification delivered"
```

### Test 2: Disabled Notifications
```bash
# In event-service .env
ENABLE_NOTIFICATIONS=false

# Restart event service
make restart-event

# Trigger event creation
# No notifications sent, no queue entries

# Queue should be empty
curl http://localhost:3009/api/notifications/queue/status
# {"queue_enabled": false}
```

### Test 3: Channel Failover
```bash
# In notification-service .env
EMAIL_ENABLED=false
TELEGRAM_ENABLED=true

# Restart notification service
docker compose restart notification-service

# Trigger event creation requesting both channels
# Email fails, Telegram retries
```

## Files Changed

### Modified Files
- `services/event/app/main.py` - Added notification initialization

### New Files
- `services/event/app/notification_helpers.py`
- `services/user/app/notification_helpers.py`
- `services/registration/app/notification_helpers.py`
- `services/ticket/app/notification_helpers.py`
- `services/payment/app/notification_helpers.py`
- `notification-service/app/main.py` - Enhanced queue processor
- `PHASE_3_IMPLEMENTATION.md` - This file

## Performance Considerations

### Response Time
- Notification sending is **non-blocking**
- Route handlers return immediately
- Queue processor runs separately in background

### Queue Processing
- **Batch size**: 10 notifications per cycle
- **Cycle time**: 30 seconds
- **Throughput**: ~20 notifications/minute (adjustable)

### Scaling
- Multiple notification-service instances can share Redis queue
- Load balancer distributes requests
- All instances process queue collaboratively

## Error Handling

### Automatic Retries
```
Attempt 1: Immediate
Attempt 2: After 60s
Attempt 3: After 120s
Attempt 4: After 240s
Attempt 5: After 480s
Failed: After 960s (max retries exceeded)
```

### Logging
All operations logged with:
- Timestamp
- User ID
- Event name
- Channel
- Status (success/failed/retry)
- Error details if applicable

## Monitoring

### Health Check
```bash
curl http://localhost:3009/health
# Returns channel status and queue size
```

### Queue Status
```bash
curl http://localhost:3009/api/notifications/queue/status
# Returns pending count and queue type
```

### Service Logs
```bash
# In notification-service directory
docker compose logs -f notification-service | grep "Queued notification"
```

## Next Steps

### Immediate (This Phase)
- [ ] Complete initialization for remaining 4 core services
- [ ] Integrate send_*_notification() into existing routes
- [ ] Test graceful degradation scenarios
- [ ] Update service health checks

### Short Term (Phase 3 Continuation)
- [ ] Add webhook support for delivery confirmations
- [ ] Implement delivery status endpoints
- [ ] Add user notification preferences
- [ ] Create admin dashboard for queue monitoring

### Long Term (Phase 4+)
- [ ] Analytics and delivery metrics
- [ ] Rate limiting and throttling
- [ ] Dead letter queue for permanently failed notifications
- [ ] Custom template engine
- [ ] Scheduled/delayed notifications

## Debugging Guide

### Queue Growing Unbounded
```bash
# Check service health
curl http://localhost:3009/health

# Check why delivery is failing
docker compose logs notification-service | grep "error\|failed"

# Clear queue if needed
curl -X POST http://localhost:3009/api/notifications/queue/clear
```

### Notifications Not Being Processed
```bash
# Check if processor is running
docker compose logs notification-service | grep "Queue processor"

# Check if queue has items
curl http://localhost:3009/api/notifications/queue/status

# Check if notification service is healthy
curl http://localhost:3009/health
```

### High Latency in Core Services
```bash
# Verify using background_tasks (not blocking)
# Check: background_tasks.add_task(client.send, ...)

# Monitor notification service
docker compose stats notification-service
```

## References

- [OPTIONAL_NOTIFICATION_SERVICE.md](OPTIONAL_NOTIFICATION_SERVICE.md) - Architecture
- [PHASE_2_MIGRATION_GUIDE.md](PHASE_2_MIGRATION_GUIDE.md) - Integration patterns
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) - Overall status
- [~/notification-service/README.md](../notification-service/README.md) - Setup guide
