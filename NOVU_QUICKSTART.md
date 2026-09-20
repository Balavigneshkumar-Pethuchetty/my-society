# Novu Quick Start Guide

**Status**: Production ready  
**Date**: 2026-09-20  
**Fallback**: Legacy SMS/Telegram/Email supported

## 5-Minute Setup

### 1. Start Novu
```bash
make up          # Start all services including Novu
# or
./scripts/setup-novu.sh  # Interactive setup
```

### 2. Access Dashboard
- Open browser: **http://localhost:3000**
- Create account and login

### 3. Create Templates
In Novu dashboard, create templates for these events:
- `refund_processed`
- `refund_rejected`  
- `payment_verified`
- `payment_rejected`
- `user_approved`

### 4. Get API Key
- Settings → API Keys → Create Key
- Copy the key

### 5. Configure
```bash
# Add to .env
NOVU_API_KEY=<your-key>
NOTIFICATION_STRATEGY=novu_with_fallback
```

### 6. Restart Services
```bash
make restart-payment
make restart-event-service
```

✅ **Done!** Notifications will now use Novu with fallback to SMS/Telegram/Email

---

## Usage in Code

### Basic Example
```python
from shared.novu_notifications import send_unified_notification

result = await send_unified_notification(
    user_id=user.id,
    event_name="refund_processed",
    payload={
        "amount": 1000,
        "currency": "INR",
        "title": "Refund Processed",
        "legacy_message": "Your refund has been approved.",
    },
    user_phone=user.phone,
    user_email=user.email,
    notify_sms=user.notify_sms,
    notify_email=user.notify_email,
)

print(f"Sent via {result['source']}: {result['success']}")
# Output: Sent via novu: True
# Or:     Sent via legacy: True (if Novu unavailable)
```

### Bulk Notifications
```python
from shared.novu_client import get_novu_client

novu = get_novu_client()

result = await novu.send_bulk_notifications(
    event_name="event_reminder",
    subscriber_ids=[user1.id, user2.id, user3.id],
    payload={
        "event_title": "Concert Night",
        "event_date": "2026-09-25",
        "legacy_message": "Don't forget Concert Night on 2026-09-25!",
    },
)

print(f"Successful: {result['successful']}, Failed: {result['failed']}")
print(f"By source: {result['by_source']}")
# Output: Successful: 3, Failed: 0
#         By source: {'novu': 3, 'legacy': 0, 'none': 0}
```

---

## Strategies

### Strategy 1: Novu with Fallback (Default ⭐)
```bash
NOTIFICATION_STRATEGY=novu_with_fallback
```
- ✅ Try Novu first
- ✅ Auto-fallback to SMS/Telegram/Email if Novu fails
- ✅ Zero-downtime migration
- **Recommended for production**

### Strategy 2: Novu Only
```bash
NOTIFICATION_STRATEGY=novu_only
```
- ✅ Novu exclusive
- ❌ No fallback (if Novu down, notifications fail)
- **Use after Novu proven stable**

### Strategy 3: Legacy Only
```bash
NOTIFICATION_STRATEGY=legacy_only
```
- ✅ Skip Novu, use legacy SMS/Telegram/Email
- ✅ Useful for debugging or gradual migration
- **Use during testing or rollback**

---

## Key Commands

### Novu Management
```bash
make novu-up               # Start Novu services
make novu-down             # Stop Novu services
make novu-restart          # Restart Novu
make novu-status           # Check health status
make logs-novu             # Follow all logs
make logs-novu-api         # Follow API logs only
```

### Testing
```bash
# Start services
make up

# Check status
make novu-status

# Watch logs while testing
make logs-novu

# Trigger a notification
curl -X POST http://localhost:8080/api/payments/refund-test

# Check what happened
docker logs society_payment_service | grep novu
```

### Debugging
```bash
# Is Novu API healthy?
curl http://localhost:3000/v1/health

# Check service status
docker ps | grep novu

# View detailed logs
docker logs society_novu_api
docker logs society_novu_worker

# Check if fallback is being used
make logs-payment | grep -i "fallback\|legacy"
```

---

## Fallback System

### When Does Fallback Trigger?

Fallback automatically activates when:

| Condition | Behavior |
|---|---|
| Novu API unreachable | Fall back to SMS/Telegram/Email |
| Novu API returns 5xx error | Fall back to SMS/Telegram/Email |
| Novu API timeout | Fall back to SMS/Telegram/Email |
| `NOVU_API_KEY` not set | Use legacy only |
| Network issues | Automatic retry + fallback |

### Legacy System Requirements

For SMS/Telegram fallback to work:
```bash
AUTH_SERVICE_API_KEY=<your-key>  # From ~/auth-service
```

For Email fallback:
```bash
GMAIL_SMTP_USER=your@gmail.com
GMAIL_APP_PASSWORD=<app-password>
```

### Fallback Response Format

```python
# Novu success
{
    "source": "novu",
    "success": true,
    "id": "novu-message-id",
    "data": {...}
}

# Fallback success
{
    "source": "legacy",
    "success": true,
    "id": "legacy-fallback-user-id",
    "data": {}
}

# Both failed
{
    "source": "none",
    "success": false,
    "id": null,
    "data": {}
}
```

---

## Environment File

### Minimal Setup
```bash
# .env or .env.prod

# Required
NOVU_API_KEY=your-api-key-here

# Optional but recommended (for fallback)
AUTH_SERVICE_API_KEY=your-auth-service-key
GMAIL_SMTP_USER=your@gmail.com
GMAIL_APP_PASSWORD=your-app-password

# Strategy (default: novu_with_fallback)
NOTIFICATION_STRATEGY=novu_with_fallback
```

### Secrets (Auto-Generated)
The setup script automatically generates if missing:
```bash
NOVU_JWT_SECRET=<random>
NOVU_ENCRYPTION_KEY=<random>
```

---

## Troubleshooting

### Problem: "Notification delivery failed"

**Solution 1**: Check if NOVU_API_KEY is set
```bash
grep NOVU_API_KEY .env
# Should output: NOVU_API_KEY=<non-empty-value>
```

**Solution 2**: Check Novu API health
```bash
curl http://localhost:3000/v1/health
# Should return: {"status":"ok"}
```

**Solution 3**: Check logs
```bash
make logs-novu | tail -50
# Look for errors in Novu API or Worker
```

**Solution 4**: Verify fallback is configured
```bash
grep AUTH_SERVICE_API_KEY .env
grep GMAIL_SMTP_USER .env
# Should both be set for fallback to work
```

### Problem: "Novu services won't start"

```bash
# Check what's running
docker ps | grep novu

# Check logs
docker logs society_novu_mongo
docker logs society_novu_redis
docker logs society_novu_api

# Restart everything
make novu-restart

# Or restart all services
make restart
```

### Problem: "Notifications go to legacy instead of Novu"

**Reason**: Either Novu is unreachable or API key is invalid

```bash
# Check API key
grep NOVU_API_KEY .env

# Test API with key
curl -H "Authorization: ApiKey YOUR_KEY" \
  http://localhost:3000/v1/health

# If it fails, regenerate key in Novu dashboard
```

### Problem: "Fallback notifications not working"

**For SMS/Telegram**:
```bash
# Check auth-service is running
curl http://host.containers.internal:8000/health

# Check API key
grep AUTH_SERVICE_API_KEY .env
```

**For Email**:
```bash
# Check Gmail is configured
grep GMAIL_SMTP_USER .env
grep GMAIL_APP_PASSWORD .env

# Test Gmail connection (from service pod)
docker exec payment-service \
  python3 -c "
  import smtplib
  smtp = smtplib.SMTP('smtp.gmail.com', 587)
  smtp.starttls()
  smtp.login('YOUR_EMAIL', 'YOUR_PASSWORD')
  print('Gmail connected')
  "
```

---

## Monitoring

### Check Status
```bash
make novu-status
# Shows container status + API health
```

### Watch Notifications in Real-Time
```bash
# Terminal 1: Watch Novu logs
make logs-novu

# Terminal 2: Watch payment service logs
make logs-payment

# Terminal 3: Trigger a notification
curl -X POST http://localhost:8080/api/payments/trigger-refund
```

### Metrics to Track
- **Success Rate**: % of notifications sent via Novu vs fallback
- **Latency**: Time from trigger to delivery
- **Error Rate**: Failed notifications
- **Channel Mix**: SMS vs Telegram vs Email

---

## Common Tasks

### Switch to Novu-Only (after testing)
```bash
# Edit .env
NOTIFICATION_STRATEGY=novu_only

# Restart
make restart
```

### Rollback to Legacy-Only
```bash
# Edit .env
NOTIFICATION_STRATEGY=legacy_only

# Restart
make restart
```

### Test Fallback Manually
```bash
# Stop Novu
make novu-down

# Send notification (will use fallback)
curl -X POST http://localhost:8080/api/payments/trigger-refund

# Check logs
make logs-payment | grep legacy

# Restart Novu
make novu-up
```

### Update Novu Templates
1. Open http://localhost:3000
2. Click on template
3. Edit content
4. Save
5. New notifications use updated template (no code change needed!)

### Restart Services After Config Change
```bash
# If you only changed NOTIFICATION_STRATEGY or NOVU_API_KEY:
make restart-payment
make restart-event-service

# If you changed Novu secrets (NOVU_JWT_SECRET, etc):
make novu-restart

# To be safe, restart everything:
make restart
```

---

## Documentation

- **Full Guide**: [NOVU_IMPLEMENTATION_GUIDE.md](NOVU_IMPLEMENTATION_GUIDE.md)
- **Code Examples**: [NOVU_MIGRATION_EXAMPLE.md](NOVU_MIGRATION_EXAMPLE.md)
- **API Reference**: [services/shared/novu_client.py](services/shared/novu_client.py)
- **Wrapper Library**: [services/shared/novu_notifications.py](services/shared/novu_notifications.py)

---

## Next Steps

1. ✅ Run setup: `./scripts/setup-novu.sh`
2. ✅ Access dashboard: http://localhost:3000
3. ✅ Create templates
4. ✅ Get API key
5. ✅ Add key to .env
6. ✅ Restart services
7. ✅ Test notifications
8. ✅ Monitor with `make logs-novu`

---

## Summary

| Aspect | Details |
|---|---|
| **Primary** | Novu centralized notification service |
| **Fallback** | Legacy SMS (auth-service) + Telegram + Email (Gmail) |
| **Strategy** | `novu_with_fallback` (default - recommended) |
| **API** | `send_unified_notification()` in all services |
| **Templates** | Managed in Novu dashboard (no code changes) |
| **Data** | MongoDB (Novu) + Postgres (legacy) |
| **Status** | Production ready with zero-downtime migration |

**Ready to go!** 🚀
