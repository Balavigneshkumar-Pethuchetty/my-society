# Novu Implementation Guide - With Fallback Support

**Status**: Ready to implement  
**Date**: 2026-09-20  
**System**: Novu + Legacy Fallback (SMS, Telegram, Email)

## Overview

This implementation provides a **two-tier notification system**:

1. **Primary**: Novu centralized notification orchestration
2. **Fallback**: Legacy auth-service (SMS/Telegram) + Gmail SMTP

### Three Strategies Available

Set via `NOTIFICATION_STRATEGY` environment variable:

| Strategy | Behavior | Use Case |
|---|---|---|
| `novu_with_fallback` | Try Novu first, fall back to legacy if unavailable | **Default - Recommended** |
| `novu_only` | Use Novu exclusively, no fallback | Once Novu is stable |
| `legacy_only` | Use legacy system, skip Novu completely | Gradual migration period |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Application Code (payment-service, event-service, etc) │
└──────────────┬──────────────────────────────────────────┘
               │
               ▼
        ┌──────────────┐
        │ send_unified │
        │notification()│
        └──────┬───────┘
               │
        ┌──────▼──────────┐
        │  Novu Client    │ (with fallback handler)
        └──────┬──────────┘
               │
         ┌─────┴──────┐
         │            │
    ┌────▼────┐   ┌───▼────────────┐
    │   Try   │   │  On Failure:   │
    │   Novu  │──▶│  Fallback Fn   │
    └────┬────┘   └────┬───────────┘
         │             │
    ┌────▼────┐   ┌────▼───────┐
    │ Novu    │   │ Legacy:    │
    │ Success │   │ - SMS      │
    │         │   │ - Telegram │
    │         │   │ - Email    │
    └─────────┘   └────────────┘
```

## Setup

### 1. Environment Variables

Add to `.env`:

```bash
# Novu API credentials (get from Novu dashboard after setup)
NOVU_API_KEY=your-novu-api-key-here

# Novu secrets (change these in production!)
NOVU_JWT_SECRET=your-jwt-secret-change-me
NOVU_ENCRYPTION_KEY=your-encryption-key-change-me

# Notification strategy
NOTIFICATION_STRATEGY=novu_with_fallback

# Legacy system still required (as fallback)
AUTH_SERVICE_API_KEY=your-auth-service-key
GMAIL_SMTP_USER=your-gmail@gmail.com
GMAIL_APP_PASSWORD=your-app-password
```

### 2. Start Novu Services

```bash
# Novu services are included in main docker-compose.yml
make up

# Verify Novu is running
docker ps | grep novu
curl http://localhost:3000/v1/health
```

### 3. Configure Novu

1. Access Novu dashboard at `http://localhost:3000`
2. Create notification templates for:
   - `refund_approved`
   - `refund_rejected`
   - `payment_verified`
   - `payment_rejected`
   - `user_approved`
   - Custom events as needed
3. Set up channels in each template:
   - SMS (via auth-service integration)
   - Telegram (via auth-service integration)
   - Email (direct to subscribers)
   - In-app

## Usage Examples

### Basic Notification

```python
from shared.novu_notifications import send_unified_notification

result = await send_unified_notification(
    user_id=user.id,
    event_name="refund_approved",
    payload={
        "amount": 1000.00,
        "currency": "INR",
        "event_title": "Annual Gala",
        "title": "Refund Approved",
        "legacy_message": "Your refund of INR 1000.00 has been approved.",
    },
    user_phone=user.phone,
    user_email=user.email,
    notify_sms=user.notify_sms,
    notify_email=user.notify_email,
    notify_telegram=user.notify_telegram,
)

if result["success"]:
    print(f"Sent via {result['source']}: {result['id']}")
```

### In Payment Service

Before (legacy only):

```python
async def notify_refund():
    recipients, message = await notify_refund_processed(conn, txn_ref, actor_sub)
    await send_channels(recipients, message)  # Uses SMS/Telegram/Email
```

After (Novu with fallback):

```python
from shared.novu_notifications import send_unified_notification

async def notify_refund():
    # ... existing DB logic ...
    
    for recipient in recipients:
        await send_unified_notification(
            user_id=recipient["id"],
            event_name="refund_processed",
            payload={
                "amount": row["amount"],
                "currency": row["currency"],
                "event_title": event["title"],
                "title": "Refund Processed",
                "legacy_message": message,  # Used if fallback occurs
            },
            user_phone=recipient["phone"],
            user_email=recipient["email"],
            notify_sms=recipient["notify_sms"],
            notify_email=recipient["notify_email"],
            notify_telegram=recipient["notify_telegram"],
        )
```

### Bulk Notifications

```python
from shared.novu_client import get_novu_client

novu = get_novu_client()

result = await novu.send_bulk_notifications(
    event_name="event_scheduled",
    subscriber_ids=[user1.id, user2.id, user3.id],
    payload={
        "event_title": "Concert Night",
        "event_date": "2026-09-25",
        "legacy_message": "You are registered for Concert Night on 2026-09-25",
    },
    tags=["event", "scheduling"]
)

print(f"Sent {result['successful']}, failed {result['failed']}")
print(f"By source: {result['by_source']}")
# Output:
# Sent 3, failed 0
# By source: {'novu': 3, 'legacy': 0, 'none': 0}
```

## Migration Timeline

### Phase 1: Setup & Testing (1-2 days)
- [ ] Start Novu services (`make up`)
- [ ] Access Novu dashboard and create templates
- [ ] Configure Novu API key in `.env`
- [ ] Test with `NOTIFICATION_STRATEGY=novu_with_fallback`
- [ ] Monitor logs for fallback activations
- [ ] Verify legacy system still works when Novu unavailable

### Phase 2: Gradual Rollout (1 week)
- [ ] Update payment-service to use `send_unified_notification()`
- [ ] Update event-service notifications
- [ ] Update user-service notifications
- [ ] Monitor metrics: what % sent via Novu vs legacy
- [ ] Adjust Novu templates based on feedback

### Phase 3: Optimize (ongoing)
- [ ] Once Novu stability confirmed (>90% via Novu):
  - Switch to `NOTIFICATION_STRATEGY=novu_only`
  - Remove legacy channel code if desired
- [ ] Set up Novu monitoring/alerting
- [ ] Implement custom Novu providers for custom channels

## Fallback Behavior

### When Fallback Activates

Fallback is triggered when:

```
1. NOVU_API_KEY is empty/missing
2. Novu API is unreachable (timeout, connection error)
3. Novu API returns error (502, 503, etc)
4. NOTIFICATION_STRATEGY = "legacy_only"
```

### Fallback Handler Behavior

The `_legacy_notification_fallback()` function:

1. Extracts `legacy_message` from payload
2. Sends via configured channels (SMS, Telegram, Email)
3. Returns `{"success": bool, "id": str}`
4. All errors are logged but don't crash the application

### Example: What Happens When Novu is Down

```python
# NOTIFICATION_STRATEGY=novu_with_fallback

result = await send_unified_notification(
    user_id="user-123",
    event_name="refund_approved",
    payload={...},
    user_phone="+91-xxx-xxxx",
    user_email="user@example.com",
    notify_sms=True,
    legacy_message="Your refund has been approved.",
)

# If Novu is down:
# 1. NovuClient tries Novu API
# 2. Gets ConnectError or timeout
# 3. Calls _legacy_notification_fallback()
# 4. Fallback sends SMS + Email via auth-service + Gmail
# 5. Returns: {
#     "source": "legacy",
#     "success": True,
#     "id": "legacy-fallback-user-123",
#     "data": {}
# }
```

## Monitoring & Logging

### Check Logs

```bash
# Novu API logs
make logs-novu-api

# Novu Worker logs
make logs-novu-worker

# Service logs (check for fallback activations)
make logs-payment | grep -i "fallback\|novu"
```

### Key Metrics to Monitor

1. **Novu Success Rate**: % of notifications sent via Novu
2. **Fallback Activation Rate**: How often fallback is triggered
3. **Delivery Latency**: Time from trigger to delivery
4. **Channel Mix**: SMS vs Telegram vs Email vs In-app

### Log Messages

```
# Novu successful
"Notification sent successfully via Novu"
  extra: {"event": "refund_approved", "user_id": "xyz", "novu_id": "abc"}

# Novu failed, falling back
"Novu API unavailable (ConnectError), falling back"
  extra: {"event": "refund_approved", "user_id": "xyz"}

# Fallback successful
"Sending notification via legacy fallback handler"
  extra: {"event": "refund_approved", "user_id": "xyz"}

# Both failed
"No fallback handler configured - notification lost"
  extra: {"event": "refund_approved", "user_id": "xyz"}
```

## Testing

### Unit Tests

```python
import pytest
from unittest.mock import AsyncMock, patch
from shared.novu_notifications import send_unified_notification

@pytest.mark.asyncio
async def test_novu_success():
    """Notification sent via Novu successfully"""
    result = await send_unified_notification(
        user_id="test-user",
        event_name="refund_approved",
        payload={"amount": 100, "legacy_message": "Test"},
        user_phone="+91-9999-9999",
        user_email="test@example.com",
    )
    assert result["source"] == "novu"
    assert result["success"] == True

@pytest.mark.asyncio
async def test_fallback_on_novu_error(monkeypatch):
    """Falls back to legacy when Novu errors"""
    # Mock Novu client to return error
    monkeypatch.setenv("NOTIFICATION_STRATEGY", "novu_with_fallback")
    # ... mock setup ...
    result = await send_unified_notification(...)
    assert result["source"] == "legacy"
    assert result["success"] == True
```

### Integration Test

```bash
# Start services with NOTIFICATION_STRATEGY=novu_with_fallback
make up

# Test with valid Novu API key
docker exec payment-service curl http://novu-api:3000/v1/health

# Test by stopping Novu
docker stop society_novu_api

# Try sending notification
curl -X POST http://localhost:8080/api/payments/refund \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"txn_ref": "..."}'

# Check logs - should see fallback activation
make logs-payment | grep "fallback"

# Restart Novu
docker start society_novu_api

# Verify normal operation resumes
```

## Troubleshooting

### Novu Services Not Starting

```bash
# Check logs
docker logs society_novu_api

# Common issues:
# 1. NOVU_JWT_SECRET or NOVU_ENCRYPTION_KEY too short
# 2. MongoDB/Redis not healthy yet
# 3. Port 3000 already in use

# Solution: Use longer secrets, wait for DB health, check ports
```

### Fallback Not Activating

```bash
# Check environment
docker exec payment-service env | grep NOTIFICATION_STRATEGY

# Should output: NOTIFICATION_STRATEGY=novu_with_fallback

# If wrong, restart service:
make restart-payment
```

### No Notifications Sent

Check in order:

1. **Is Novu healthy?**
   ```bash
   curl http://localhost:3000/v1/health
   ```

2. **Is NOVU_API_KEY set and valid?**
   ```bash
   docker exec payment-service env | grep NOVU_API_KEY
   ```

3. **Is fallback enabled?**
   ```bash
   docker exec payment-service env | grep NOTIFICATION_STRATEGY
   # Should be: novu_with_fallback or legacy_only
   ```

4. **Check logs**
   ```bash
   make logs-payment | tail -100 | grep -i "novu\|fallback\|notification"
   ```

5. **Check legacy system health**
   ```bash
   # Is auth-service reachable?
   curl http://host.containers.internal:8000/health
   
   # Is Gmail SMTP configured?
   docker exec payment-service env | grep GMAIL
   ```

### Partial Failures

Some channels work, others don't:

```python
# Novu might deliver to Email but not SMS
result = await send_unified_notification(...)
# result["source"] = "novu"
# result["success"] = True
# But SMS might have failed in Novu's worker

# Check Novu logs:
docker logs society_novu_worker | grep error
```

**Solution**: Use Novu dashboard to check delivery status per channel.

## Reverting to Legacy-Only

If you need to disable Novu temporarily:

```bash
# Edit .env
NOTIFICATION_STRATEGY=legacy_only

# Restart services
make restart-payment
make restart-event-service

# Novu services can remain running (or be stopped)
# Notifications will use SMS/Telegram/Email only
```

## Security Considerations

### Secrets Management

```bash
# DON'T use default secrets in production:
NOVU_JWT_SECRET=change-me-in-production      # ❌
NOVU_ENCRYPTION_KEY=change-me-in-production  # ❌

# Generate strong secrets:
# For JWT:
openssl rand -base64 32

# For encryption:
# Novu uses Fernet encryption (Python-compatible)
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### API Key Rotation

1. Generate new Novu API key in dashboard
2. Update `NOVU_API_KEY` in `.env`
3. Restart services: `make up --force-recreate novu-api`
4. Verify notifications still work
5. Revoke old API key in dashboard

### Data Privacy

The fallback handler receives:
- `user_phone`: Only last 4 digits logged (masked)
- `user_email`: Not logged
- `legacy_message`: Logged as-is (may contain PII)

All Novu payloads are transmitted over HTTPS in production.

## Next Steps

1. **Immediate**: Review NOVU_SETUP.md for detailed setup instructions
2. **Day 1**: Start Novu, create templates, test fallback
3. **Day 2-3**: Migrate first service (payment-service)
4. **Day 4-7**: Monitor, optimize, migrate remaining services
5. **Week 2+**: Evaluate Novu-only strategy if stable

---

## Files Modified/Created

```
Created:
  - services/shared/novu_notifications.py (unified notification wrapper)
  - NOVU_IMPLEMENTATION_GUIDE.md (this file)

Modified:
  - docker-compose.yml (added Novu services)
  - .env.example (added Novu settings)
  - services/shared/novu_client.py (added fallback support)
  - services/payment/app/config.py (added Novu settings)
  - services/event/app/config.py (added Novu settings)
```

## Questions?

See also:
- `NOVU_READY.md` - Quick overview
- `NOVU_MIGRATION.md` - Detailed service migration
- `NOVU_QUICK_START.md` - Morning implementation checklist
