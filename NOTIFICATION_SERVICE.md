# Notification Service Architecture

## Overview

The **Notification Service** is a centralized microservice that handles all notification delivery across the Society Events platform. It consolidates notification logic from individual services into a single point of control, enabling consistent delivery strategies and monitoring.

**Location:** `services/notification/`  
**Port:** 3009  
**API Prefix:** `/api/notifications/`

## Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│ Other Services (user, event, registration, etc.)            │
│ Make HTTP calls to notification-service                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │  Notification Service      │
        │  (Port 3009)               │
        ├────────────────────────────┤
        │ • Request validation       │
        │ • Strategy routing         │
        │ • Audit logging            │
        └───┬──────────┬──────────┬──┘
            │          │          │
      ┌─────▼────┐ ┌───▼────┐ ┌──▼──────┐
      │   Novu   │ │ Legacy  │ │ In-app  │
      │ (Primary)│ │ SMS/Tel │ │ (User)  │
      └──────────┘ └────┬────┘ └─────────┘
                        │
                   ┌────▼────┐
                   │Gmail    │
                   │SMTP     │
                   └─────────┘
```

### Delivery Strategy

Three routing strategies are available via `NOVU_STRATEGY` env var:

1. **`NOVU_ONLY`** — Use Novu exclusively; fail if Novu unavailable
2. **`NOVU_WITH_FALLBACK`** (default) — Try Novu first; fall back to SMS/Telegram/Email if it fails
3. **`FALLBACK_ONLY`** — Skip Novu; use only legacy SMS/Telegram/Email

This allows graceful degradation: if Novu is down, notifications still go out via fallback channels.

### Database Schema

Notifications are logged in the shared `society_events` database under the `notification` schema (isolated via role-based access):

**Tables:**
- `notification_logs` — Audit trail of all sent notifications (user_id, event_name, source, status, payload)
- `notification_attempts` — Per-channel delivery attempts with retry info
- `notification_config` — Runtime configuration (which channels enabled, strategy)

See `db/migrations/042_notification_service_schema.sql`.

## API Endpoints

### Send Unified Notification

```http
POST /api/notifications/send
X-Api-Key: <INTERNAL_API_KEY>

{
  "user_id": "user-uuid",
  "event_name": "refund_approved",
  "payload": {
    "amount": 100,
    "currency": "INR",
    "event_title": "Annual Gala"
  },
  "user_phone": "+91-9876543210",
  "user_email": "user@example.com",
  "legacy_message": "Your refund of INR 100.00 has been approved.",
  "notify_sms": true,
  "notify_email": true,
  "notify_telegram": true,
  "tags": ["refund", "urgent"]
}
```

**Response:**
```json
{
  "source": "novu",
  "success": true,
  "id": "transaction-id",
  "data": {}
}
```

### Send Bulk Notifications

```http
POST /api/notifications/bulk
X-Api-Key: <INTERNAL_API_KEY>

{
  "user_ids": ["user-1", "user-2", "user-3"],
  "event_name": "event_cancelled",
  "payload": { "event_title": "Summer Gala" },
  "legacy_message": "The Summer Gala has been cancelled."
}
```

### Record In-App Notification

```http
POST /api/notifications/in-app
X-Api-Key: <INTERNAL_API_KEY>

{
  "user_id": "user-uuid",
  "type": "payment_approved",
  "title": "Payment Approved",
  "message": "Your payment of INR 500 has been approved.",
  "related_id": "payment-id",
  "event_id": "event-id"
}
```

### Get Notification Status

```http
GET /api/notifications/status/{notification_id}
X-Api-Key: <INTERNAL_API_KEY>
```

### Get Service Configuration

```http
GET /api/notifications/config
X-Api-Key: <INTERNAL_API_KEY>
```

## Usage from Other Services

### Python (httpx)

```python
import httpx
from app.config import settings

async def send_notification(user_id: str, event_name: str, payload: dict):
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "http://notification-service:3009/api/notifications/send",
            json={
                "user_id": user_id,
                "event_name": event_name,
                "payload": payload,
                "user_phone": phone,
                "user_email": email,
                "legacy_message": "Your booking has been confirmed",
                "notify_sms": True,
                "notify_email": True,
            },
            headers={"X-Api-Key": settings.internal_api_key},
            timeout=30.0,
        )
        return response.json()
```

### Direct Integration (No HTTP Call)

For services within the same pod/network, you can import directly:

```python
from shared.novu_notifications import send_unified_notification

result = await send_unified_notification(
    user_id=user_id,
    event_name="refund_approved",
    payload={"amount": 100},
    user_phone=phone,
    user_email=email,
    legacy_message="Refund approved",
)
```

## Configuration

Set these environment variables:

```bash
# Novu
NOVU_API_KEY=your_novu_api_key
NOVU_BACKEND_URL=https://api.novu.co
NOVU_STRATEGY=NOVU_WITH_FALLBACK

# Legacy SMS/Telegram (via auth-service)
AUTH_SERVICE_URL=http://host.containers.internal:8000
AUTH_SERVICE_API_KEY=your_auth_service_key

# Email (Gmail SMTP)
GMAIL_SMTP_USER=your-email@gmail.com
GMAIL_APP_PASSWORD=your_app_password

# Database role (created by migration 042)
NOTIFICATION_DB_USER=notification_role
NOTIFICATION_DB_PASSWORD=secure_password

# Service-to-service auth
INTERNAL_API_KEY=your_internal_api_key

# User service (for in-app notifications)
USER_SERVICE_URL=http://user-service:3001

# Async processing
USE_BACKGROUND_TASKS=true
```

## Migrations

### When adding notification logic to a service:

1. **Stop using local notification code** — remove imports from `app.notifications`, `app.email`, etc.
2. **Add HTTP call to notification-service** — see "Usage from Other Services" above
3. **Ensure `X-Api-Key` header** — pass `INTERNAL_API_KEY` with every request
4. **Test fallback channels** — verify SMS/Email work if Novu is disabled

### When deploying:

```bash
# Apply the schema migration (creates notification schema + roles)
make migrate

# Verify notification-service is running
make ps

# Check logs
make logs-notification
```

## Monitoring

### Health Check

```bash
curl http://localhost:3009/health
```

### Logs

```bash
# Follow real-time logs
make logs-notification

# Docker
docker compose logs -f notification-service
```

### Status

```bash
make ps | grep notification
```

## Performance Considerations

### Async Processing

By default, `USE_BACKGROUND_TASKS=true` means notification sends are queued (non-blocking):

```python
# Caller gets response immediately
{
  "source": "pending",
  "success": true,
  "message": "Notification queued for delivery"
}
```

The actual send happens in the background. This prevents long-running SMS/Email operations from blocking the user's request.

To disable (send synchronously):
```bash
USE_BACKGROUND_TASKS=false
```

### Retry Logic

Failed delivery attempts are logged in `notification_attempts` table. Implement a background job to retry failed notifications:

```python
# Pseudo-code: background task
async def retry_failed_notifications():
    failed = await get_failed_attempts()
    for attempt in failed:
        await send_unified_notification(...)
        await mark_attempt_as_retried()
```

## Troubleshooting

### Novu is Down

If Novu API is unreachable:
- With `NOVU_WITH_FALLBACK`: notifications fall back to SMS/Telegram/Email
- With `NOVU_ONLY`: notifications fail
- Check `NOVU_API_KEY` and `NOVU_BACKEND_URL`

### SMS/Telegram Not Sent

- Verify `AUTH_SERVICE_URL` and `AUTH_SERVICE_API_KEY` are correct
- Check auth-service is running (`cd ~/auth-service && podman-compose ps`)
- Validate phone number format

### Email Not Sent

- Verify `GMAIL_SMTP_USER` and `GMAIL_APP_PASSWORD`
- Gmail requires "App Passwords" (with 2FA enabled)
- Check mail is not in spam

### Service Won't Start

- Check `NOTIFICATION_DB_USER` and `NOTIFICATION_DB_PASSWORD` in `.env`
- Verify migration 042 has been applied (`make migrate-status`)
- Check logs: `make logs-notification`

## Future Enhancements

- [ ] Batch sending optimization (fan-out to Novu in parallel)
- [ ] WebSocket support for delivery status updates
- [ ] Notification preference management (do-not-disturb hours, channel preferences)
- [ ] Template versioning and A/B testing
- [ ] Delivery analytics dashboard
- [ ] Webhook handlers for Novu delivery events
