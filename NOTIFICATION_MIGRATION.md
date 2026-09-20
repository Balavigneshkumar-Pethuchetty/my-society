# Notification Service Migration Guide

This guide explains how to migrate individual services to use the centralized **notification-service** instead of handling notifications locally.

## Overview

**Before:** Each service has its own `app/notifications.py` with email/SMS/Telegram logic  
**After:** Services call `notification-service` HTTP endpoint; notification-service handles all delivery

## Benefits of Migration

- **Single point of control** — change notification strategy in one place, affects all services
- **Easier testing** — mock a single HTTP endpoint instead of multiple channels
- **Better monitoring** — centralized audit trail in `notification.notification_logs` table
- **Faster feature delivery** — add new channels (Slack, WhatsApp) without touching service code

## General Steps

### 1. Update Service Configuration

Add notification-service URL and credentials to your service's `.env`:

```bash
# In services/<service>/.env.example and docker-compose.yml environment
NOTIFICATION_SERVICE_URL=http://notification-service:3009
INTERNAL_API_KEY=your_internal_api_key
```

### 2. Import the Notification Client

```python
from services.shared.notification_client import NotificationClient
from app.config import settings

# In your service's config.py or initialization
notification_client = NotificationClient(
    base_url=settings.notification_service_url,
    api_key=settings.internal_api_key,
)
```

### 3. Replace Local Notification Calls

#### Before (Local Notification)

```python
# In registration/app/notifications.py
async def resolve_and_record(...):
    managers = await get_managers(event_id)
    # ... resolve managers ...
    for user_id in users:
        await post_notification(user_id, type_, title, message)

async def send_channels(recipients: list, message: str):
    # ... send SMS/Telegram/Email directly ...
```

#### After (Using Notification Service)

```python
# In registration/app/notifications.py
from services.shared.notification_client import NotificationClient

notification_client = NotificationClient(
    base_url="http://notification-service:3009",
    api_key="<INTERNAL_API_KEY>",
)

async def resolve_and_record(...):
    managers = await get_managers(event_id)
    manager_ids = list({...} - {actor_user_id})
    
    if not manager_ids:
        return []
    
    users = await get_by_ids(manager_ids)
    
    # Record in-app notifications
    for user_id in users:
        await notification_client.send_in_app(
            user_id=user_id,
            type_=type_,
            title=title,
            message=message,
            related_id=related_id,
            event_id=event_id,
        )
    
    return [
        {
            "id": u["id"],
            "phone": u.get("phone"),
            "email": u.get("email"),
            "title": title,
            "notify_sms": u.get("notify_sms", True),
            "notify_email": u.get("notify_email", True),
            "notify_telegram": u.get("notify_telegram", True),
        }
        for u in users.values()
    ]

async def send_channels(recipients: list, message: str):
    """Send notifications via centralized notification-service."""
    if not recipients:
        return
    
    for recipient in recipients:
        await notification_client.send(
            user_id=recipient["id"],
            event_name="manager_notification",
            payload={
                "title": recipient.get("title", "Notification"),
                "message": message,
                "legacy_message": message,
            },
            user_phone=recipient.get("phone"),
            user_email=recipient.get("email"),
            notify_sms=recipient.get("notify_sms", True),
            notify_email=recipient.get("notify_email", True),
            notify_telegram=recipient.get("notify_telegram", True),
        )
```

## Service-by-Service Migration

### 1. **registration-service**

**Current State:**
- `app/notifications.py` — sends email (Gmail) + SMS/Telegram (auth-service) to event managers
- Called when: payment screenshot submitted, booking cancelled, refund requested

**Migration Steps:**

```python
# In services/registration/app/config.py
notification_service_url: str = os.getenv("NOTIFICATION_SERVICE_URL", "http://notification-service:3009")

# In services/registration/app/main.py dependencies
from services.shared.notification_client import NotificationClient

notification_client = NotificationClient(
    base_url=settings.notification_service_url,
    api_key=settings.internal_api_key,
)

# In services/registration/app/notifications.py — replace send_channels()
async def send_channels(recipients: list, message: str, event_id: str, notification_type: str):
    if not recipients:
        return
    
    for recipient in recipients:
        await notification_client.send(
            user_id=recipient["id"],
            event_name=notification_type,
            payload={
                "message": message,
                "event_id": event_id,
            },
            user_phone=recipient.get("phone"),
            user_email=recipient.get("email"),
            legacy_message=message,
            notify_sms=recipient.get("notify_sms", True),
            notify_email=recipient.get("notify_email", True),
            notify_telegram=recipient.get("notify_telegram", True),
        )
```

**Delete after migration:**
- `app/email.py` — email logic moves to notification-service
- Direct `auth-service` SMS/Telegram calls in `notifications.py`

### 2. **event-service**

**Current State:**
- `app/notifications.py` — sends SMS/Telegram for event updates
- Called when: event published, cancelled, details updated

**Migration Steps:**

```python
# Similar pattern to registration-service
# Replace `send_notification_emails_sequential()` calls with:

await notification_client.send(
    user_id=user_id,
    event_name="event_published",  # Novu template name
    payload={
        "event_title": event.title,
        "event_date": event.date,
    },
    legacy_message=f"Event {event.title} has been published",
    # ... rest of params
)
```

### 3. **user-service**

**Current State:**
- `app/notifications.py` — sends user registration/approval notifications
- Called when: user created, role granted, email verified

**Migration Steps:**

```python
# In user-service, replace local send calls:

await notification_client.send(
    user_id=user_id,
    event_name="user_registered",
    payload={
        "user_name": user.name,
        "role": user.role,
    },
    legacy_message="Welcome to Society Events!",
    # ... rest of params
)
```

### 4. **payment-service**

**Current State:**
- `app/notifications.py` — sends refund status notifications
- Called when: refund approved/rejected, UPI payment received

**Migration Steps:**

```python
await notification_client.send(
    user_id=user_id,
    event_name="refund_approved",
    payload={
        "refund_amount": amount,
        "transaction_id": txn_id,
        "currency": "INR",
    },
    legacy_message=f"Your refund of INR {amount} has been approved",
    # ... rest of params
)
```

### 5. **ticket-service**

**Current State:**
- `app/notifications.py` — sends ticket issuance confirmations
- Called when: complimentary ticket issued, QR generated

**Migration Steps:**

```python
await notification_client.send(
    user_id=user_id,
    event_name="ticket_issued",
    payload={
        "ticket_id": ticket.id,
        "event_title": event.title,
        "qr_code": qr_data,
    },
    legacy_message="Your ticket is ready. Show your QR code at the gate.",
    # ... rest of params
)
```

## Fallback During Migration

To migrate services gradually without breaking existing notifications:

### Option A: Dual-Write (Recommended for Critical Services)

```python
# Send via both old and new system until migration is verified
async def send_notification(user_id, message, channels):
    # Try new notification-service
    try:
        result = await notification_client.send(...)
        if result["success"]:
            return result
    except Exception as e:
        logger.warning(f"Notification service failed: {e}")
    
    # Fall back to old local logic
    logger.info("Falling back to local notification logic")
    return await send_local_notification(user_id, message, channels)
```

### Option B: Feature Flag

```python
if settings.use_notification_service:
    result = await notification_client.send(...)
else:
    result = await send_local_notification(...)
```

Add to `.env`:
```bash
USE_NOTIFICATION_SERVICE=true
```

## Testing Migration

### Unit Tests

Mock the `NotificationClient`:

```python
from unittest.mock import AsyncMock, patch

async def test_send_notification():
    with patch("app.notifications.notification_client") as mock_client:
        mock_client.send.return_value = {
            "success": True,
            "source": "novu",
            "id": "test-id",
        }
        
        result = await send_notification(...)
        
        assert result["success"]
        mock_client.send.assert_called_once()
```

### Integration Tests

Test against real notification-service:

```python
async def test_send_notification_integration():
    # Start notification-service in test environment
    client = NotificationClient(base_url="http://localhost:3009")
    
    result = await client.send(
        user_id="test-user",
        event_name="test_event",
        payload={"test": "data"},
    )
    
    assert result["success"]
    assert result["source"] in ["novu", "legacy_email", "legacy_sms"]
```

### Manual Testing

```bash
# Start services
make up

# Test from any service
curl -X POST http://localhost:3009/api/notifications/send \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $INTERNAL_API_KEY" \
  -d '{
    "user_id": "test-user-id",
    "event_name": "test_event",
    "payload": {},
    "user_email": "test@example.com",
    "legacy_message": "Test message",
    "notify_email": true
  }'

# Check logs
make logs-notification
```

## Cleanup After Migration

Once all services are migrated:

1. **Remove local notification code** from each service:
   - Delete `app/notifications.py` (or empty it with deprecation note)
   - Delete `app/email.py` if only used for notifications
   - Remove direct auth-service SMS/Telegram calls

2. **Update documentation** — point to `NOTIFICATION_SERVICE.md`

3. **Remove env vars** from individual services (they're now in notification-service):
   - `GMAIL_SMTP_USER`
   - `GMAIL_APP_PASSWORD`
   - `AUTH_SERVICE_URL` / `AUTH_SERVICE_API_KEY` (keep for other uses)

4. **Verify in staging** — run integration tests against real Novu/auth-service before production

## Troubleshooting

### "notification-service is down" errors

If you get connection errors during migration:

```bash
# Check if notification-service is running
make ps | grep notification

# Check logs
make logs-notification

# Restart if needed
make restart-notification-service
```

### Notifications not being delivered

Check the routing strategy:

```bash
# Get current config
curl http://localhost:3009/api/notifications/config \
  -H "X-Api-Key: $INTERNAL_API_KEY"

# Should show enabled channels and strategy
{
  "novu_enabled": true,
  "novu_strategy": "NOVU_WITH_FALLBACK",
  "email_enabled": true,
  "sms_telegram_enabled": true
}
```

### "Invalid API key" errors

Verify `INTERNAL_API_KEY` matches:

```bash
# In root .env
grep INTERNAL_API_KEY .env

# Must match what you're sending in X-Api-Key header
```

## Timeline

Suggested rollout order (critical → optional):

1. **Week 1:** payment-service (refunds, payments) + registration-service (cart, bookings)
2. **Week 2:** event-service (event updates) + ticket-service (ticket delivery)
3. **Week 3:** user-service (accounts, approvals)
4. **Week 4:** Clean up old notification code, verify no regressions

## Rollback Plan

If migration breaks in production:

```bash
# Revert service to old notification code
git checkout <old-commit> -- services/registration/app/notifications.py
make restart-registration-service

# Disable notification-service temporarily
make down notification-service
```

Then investigate logs and try again.
