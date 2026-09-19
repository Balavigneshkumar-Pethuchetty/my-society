# Novu Migration Guide

## Setup Instructions

### 1. Start Novu
```bash
cd ~/event-management

# Update environment variables in .env.novu.example → .env
cp .env.novu.example .env.novu

# Start Novu services
docker-compose -f docker-compose.novu.yml up -d

# Wait for services to be healthy
docker ps | grep novu

# Access dashboard: http://localhost:3000
```

### 2. Create Novu API Key
1. Go to http://localhost:3000
2. Create account or login
3. Go to Settings → API Keys
4. Create new API key
5. Copy to `.env` as `NOVU_API_KEY`

### 3. Configure Channels in Novu Dashboard

#### Telegram Setup
1. Settings → Integrations → Telegram
2. Add bot token (from Telegram BotFather)
3. Enable integration

#### SMS Setup (Twilio)
1. Settings → Integrations → Twilio
2. Add Account SID, Auth Token, Phone Number
3. Enable integration

#### In-App Notifications
- Already enabled by default

### 4. Install SDK in Services
```bash
# Add to requirements in each service
pip install novu httpx
```

---

## Service Migration Guide

### Payment Service
**File:** `services/payment/app/notifications.py`

**Before:**
```python
async def notify_refund_approved(user_id: str, amount: float):
    await send_sms(user_id, f"Refund of ₹{amount} approved")
    await send_telegram(user_id, f"Refund of ₹{amount} approved")
    await send_in_app(user_id, f"Refund of ₹{amount} approved")

async def notify_refund_failed(user_id: str, reason: str):
    await send_sms(user_id, f"Refund failed: {reason}")
    await send_telegram(user_id, f"Refund failed: {reason}")
```

**After:**
```python
from shared.novu_client import get_novu_client

novu = get_novu_client()

async def notify_refund_approved(user_id: str, amount: float):
    await novu.send_notification(
        event_name="refund_approved",
        subscriber_id=user_id,
        payload={"amount": amount, "currency": "INR"},
        tags=["refund", "payment"]
    )

async def notify_refund_failed(user_id: str, reason: str):
    await novu.send_notification(
        event_name="refund_failed",
        subscriber_id=user_id,
        payload={"reason": reason},
        tags=["refund", "payment"]
    )
```

**Novu Template Setup:**
- Template: `refund_approved`
  - SMS: "Refund of {{amount}} {{currency}} approved"
  - Telegram: "✅ Refund of ₹{{amount}} approved"
  - In-app: "Your refund has been approved!"

- Template: `refund_failed`
  - SMS: "Refund failed: {{reason}}"
  - Telegram: "❌ Refund failed: {{reason}}"

---

### User Service
**File:** `services/user/app/notifications.py`

**Before:**
```python
async def notify_user_approved(user_id: str, username: str):
    await send_email(f"{username}@example.com", "Account Approved")
    await send_telegram(user_id, "Your account has been approved!")
```

**After:**
```python
from shared.novu_client import get_novu_client

novu = get_novu_client()

async def notify_user_approved(user_id: str, username: str):
    await novu.send_notification(
        event_name="user_approved",
        subscriber_id=user_id,
        payload={"username": username},
        tags=["user", "approval"]
    )
```

**Novu Template:** `user_approved`
- Telegram: "✅ Your account has been approved! Welcome aboard!"
- In-app: "Account activated successfully"

---

### Registration Service
**File:** `services/registration/app/notifications.py`

**Before:**
```python
async def notify_registration_confirmed(user_id: str, event_name: str):
    await send_sms(user_id, f"Registration confirmed for {event_name}")
    await send_telegram(user_id, f"You're registered for {event_name}")
```

**After:**
```python
from shared.novu_client import get_novu_client

novu = get_novu_client()

async def notify_registration_confirmed(user_id: str, event_name: str):
    await novu.send_notification(
        event_name="registration_confirmed",
        subscriber_id=user_id,
        payload={"event_name": event_name},
        tags=["registration", "event"]
    )
```

---

### Ticket Service
**File:** `services/ticket/app/notifications.py`

**Before:**
```python
async def notify_ticket_issued(user_id: str, event_id: str, qr_code: str):
    await send_in_app(user_id, "Your ticket is ready!")
    await send_sms(user_id, "Ticket ready - show QR at gate")
```

**After:**
```python
from shared.novu_client import get_novu_client

novu = get_novu_client()

async def notify_ticket_issued(user_id: str, event_id: str, qr_code: str):
    await novu.send_notification(
        event_name="ticket_issued",
        subscriber_id=user_id,
        payload={"event_id": event_id, "qr_code": qr_code},
        tags=["ticket", "event"]
    )
```

---

### Event Service
**File:** `services/event/app/notifications.py`

**Before:**
```python
async def notify_event_created(admin_id: str, event_name: str):
    await send_email(admin_id, f"Event '{event_name}' created")
```

**After:**
```python
from shared.novu_client import get_novu_client

novu = get_novu_client()

async def notify_event_created(admin_id: str, event_name: str):
    await novu.send_notification(
        event_name="event_created",
        subscriber_id=admin_id,
        payload={"event_name": event_name},
        tags=["event", "admin"]
    )
```

---

### Visitor Service
**File:** `services/visitor/app/notifications.py`

**Before:**
```python
async def notify_pass_issued(visitor_id: str, event_name: str):
    await send_sms(visitor_id, f"Your pass for {event_name} is ready")
```

**After:**
```python
from shared.novu_client import get_novu_client

novu = get_novu_client()

async def notify_pass_issued(visitor_id: str, event_name: str):
    await novu.send_notification(
        event_name="pass_issued",
        subscriber_id=visitor_id,
        payload={"event_name": event_name},
        tags=["pass", "visitor"]
    )
```

---

## Testing Checklist

### Unit Tests
- [ ] Test notification calls don't crash
- [ ] Mock Novu client
- [ ] Verify payload structure

### Integration Tests
```bash
# Test SMS delivery
curl -X POST http://localhost:3001/v1/events/trigger \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -d '{
    "name": "refund_approved",
    "to": {"subscriberId": "test-user-123"},
    "payload": {"amount": 100, "currency": "INR"}
  }'
```

### Manual Tests
- [ ] Refund notification → Check SMS/Telegram
- [ ] User approval → Check notification
- [ ] Event created → Check dashboard
- [ ] Ticket issued → Check in-app
- [ ] Fallback test → Disable SMS, verify Telegram sent

---

## Deployment Steps

### 1. Add Novu to docker-compose.yml
```bash
docker-compose -f docker-compose.novu.yml up -d
```

### 2. Update service .env files
```bash
# Copy these to each service's .env
NOVU_API_KEY=<your_key>
NOVU_BASE_URL=http://novu-api:3000
```

### 3. Install dependencies
```bash
# In each service directory
pip install novu httpx
```

### 4. Rebuild services
```bash
cd ~/event-management
make restart
```

### 5. Verify connectivity
```bash
docker logs payment-service | grep -i novu
docker logs user-service | grep -i novu
```

---

## Monitoring

### Check Novu Dashboard
- http://localhost:3000/notifications
- See delivery status for all notifications
- View logs for any failures

### Splunk Logging
```
index=* novu
```

### Alerts
- [ ] Failed notification rate > 5%
- [ ] API latency > 1s
- [ ] Novu service down

---

## Rollback Plan

If issues occur:
```bash
# 1. Stop Novu
docker-compose -f docker-compose.novu.yml down

# 2. Revert code changes
git revert <commit>

# 3. Rebuild services
make restart

# 4. Verify old notifications work
```

---

## Cleanup (Day 2)

- [ ] Remove old notification code
- [ ] Delete send_sms(), send_telegram() functions
- [ ] Update documentation
- [ ] Monitor metrics for 24 hours
- [ ] Celebrate! 🎉
