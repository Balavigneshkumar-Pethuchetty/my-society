# Novu Migration Examples - Service by Service

Quick reference for migrating each service from legacy to Novu-based notifications.

## Payment Service

### Before (Legacy Only)

```python
# services/payment/app/notifications.py
async def notify_refund_processed(conn, txn_ref: str, actor_sub: str):
    # ... fetch data from DB ...
    
    recipients, message = [{"phone": "+91-xxx", "email": "user@ex.com", ...}], "Your refund..."
    await send_channels(recipients, message)  # Sends via SMS/Telegram/Email only
```

### After (Novu with Fallback)

```python
# services/payment/app/notifications.py
from shared.novu_notifications import send_unified_notification

async def notify_refund_processed(conn, txn_ref: str, actor_sub: str):
    row = await conn.fetchrow(
        "SELECT pt.id::text AS txn_id, pt.user_id::text AS user_id, ... FROM payment_transaction pt WHERE pt.txn_ref = $1",
        txn_ref,
    )
    
    recipient = await get_by_id(row["user_id"]) or {}
    message = f"Your refund of {row['currency']} {row['amount']} has been processed."
    
    # Send via Novu with fallback
    result = await send_unified_notification(
        user_id=row["user_id"],
        event_name="refund_processed",
        payload={
            "amount": float(row["amount"]),
            "currency": row["currency"],
            "event_title": event["title"],
            "title": "Refund Processed",
            "txn_ref": txn_ref,
            "link": f"{settings.app_public_url}/payments?txn_ref={txn_ref}",
            "legacy_message": message,  # Used if fallback to SMS/Telegram/Email
        },
        user_phone=recipient.get("phone"),
        user_email=recipient.get("email"),
        notify_sms=recipient.get("notify_sms", True),
        notify_email=recipient.get("notify_email", True),
        notify_telegram=recipient.get("notify_telegram", True),
    )
    
    logger.info(f"Refund notification sent via {result['source']}: {result['id']}")
```

### Benefits

- **Novu tries first**: Fast, centralized delivery with delivery tracking
- **Automatic fallback**: If Novu unavailable → SMS/Telegram/Email still work
- **Template management**: Update message templates in Novu dashboard without code changes
- **Unified logging**: All channels tracked in one place

---

## Event Service

### Example: Event Cancellation Notification

```python
# services/event/app/notifications.py
from shared.novu_notifications import send_unified_notification

async def notify_event_cancelled(event_id: str, cancellation_reason: str):
    event = await get_event(event_id)
    registrations = await conn.fetch(
        "SELECT DISTINCT user_id FROM registration WHERE event_id = $1",
        event_id
    )
    
    for reg in registrations:
        user = await get_by_id(reg["user_id"])
        
        await send_unified_notification(
            user_id=reg["user_id"],
            event_name="event_cancelled",
            payload={
                "event_title": event["title"],
                "cancellation_date": event["cancelled_at"],
                "reason": cancellation_reason,
                "refund_link": f"{settings.app_public_url}/refunds",
                "title": f"Event Cancelled: {event['title']}",
                "legacy_message": f"The event '{event['title']}' has been cancelled. "
                                 f"Reason: {cancellation_reason}. "
                                 f"Refunds will be processed within 7 days.",
            },
            user_phone=user.get("phone"),
            user_email=user.get("email"),
            notify_sms=user.get("notify_sms", True),
            notify_email=user.get("notify_email", True),
            notify_telegram=user.get("notify_telegram", True),
            tags=["event", "cancellation"],
        )
```

---

## User Service

### Example: User Approval Notification

```python
# services/user/app/notifications.py
from shared.novu_notifications import send_unified_notification

async def notify_user_approved(user_id: str):
    user = await get_by_id(user_id)
    
    await send_unified_notification(
        user_id=user_id,
        event_name="user_approved",
        payload={
            "username": user.get("username") or "Member",
            "approval_date": datetime.now().isoformat(),
            "title": "Account Approved",
            "login_link": f"{settings.app_public_url}/login",
            "legacy_message": f"Your account has been approved. You can now log in.",
        },
        user_phone=user.get("phone"),
        user_email=user.get("email"),
        notify_email=True,  # Always email for account approval
        tags=["account", "approval"],
    )
```

---

## Registration Service

### Example: Payment Verification Reminder

```python
# services/registration/app/notifications.py
from shared.novu_notifications import send_unified_notification

async def notify_payment_verification_pending(registration_id: str):
    reg = await conn.fetchrow(
        "SELECT r.user_id, r.event_id, pt.id as txn_id FROM registration r "
        "JOIN payment_transaction pt ON r.id = pt.registration_id "
        "WHERE r.id = $1",
        registration_id
    )
    
    event = await get_event(reg["event_id"])
    user = await get_by_id(reg["user_id"])
    
    await send_unified_notification(
        user_id=reg["user_id"],
        event_name="payment_pending_review",
        payload={
            "event_title": event["title"],
            "txn_id": str(reg["txn_id"]),
            "title": f"Payment Under Review - {event['title']}",
            "review_link": f"{settings.app_public_url}/payments",
            "legacy_message": f"Your payment screenshot for '{event['title']}' is under review. "
                             f"We'll notify you once verified.",
        },
        user_phone=user.get("phone"),
        user_email=user.get("email"),
        notify_sms=user.get("notify_sms", True),
        notify_email=user.get("notify_email", True),
        notify_telegram=user.get("notify_telegram", True),
        tags=["payment", "pending"],
    )
```

---

## Ticket Service

### Example: Ticket Generated Notification

```python
# services/ticket/app/notifications.py
from shared.novu_notifications import send_unified_notification

async def notify_ticket_generated(ticket_id: str):
    ticket = await conn.fetchrow(
        "SELECT t.id, t.user_id, t.event_id, t.qr_code FROM ticket WHERE id = $1",
        ticket_id
    )
    
    event = await get_event(ticket["event_id"])
    user = await get_by_id(ticket["user_id"])
    
    await send_unified_notification(
        user_id=ticket["user_id"],
        event_name="ticket_ready",
        payload={
            "event_title": event["title"],
            "event_date": event["event_date"],
            "ticket_id": str(ticket["id"]),
            "title": "Your Ticket is Ready",
            "ticket_link": f"{settings.app_public_url}/tickets/{ticket['id']}",
            "legacy_message": f"Your ticket for '{event['title']}' is ready! "
                             f"Show your QR code at the entrance.",
        },
        user_phone=user.get("phone"),
        user_email=user.get("email"),
        notify_email=True,  # Always email for tickets
        tags=["ticket", "event"],
    )
```

---

## Bulk Notifications (Broadcast)

### Example: Event Reminder to All Attendees

```python
# services/event/app/notifications.py
from shared.novu_client import get_novu_client

async def send_event_reminder_broadcast(event_id: str):
    event = await get_event(event_id)
    
    # Get all registered users
    registrations = await conn.fetch(
        "SELECT DISTINCT user_id FROM registration WHERE event_id = $1 AND status = 'confirmed'",
        event_id
    )
    
    user_ids = [str(reg["user_id"]) for reg in registrations]
    
    novu = get_novu_client()
    result = await novu.send_bulk_notifications(
        event_name="event_reminder",
        subscriber_ids=user_ids,
        payload={
            "event_title": event["title"],
            "event_date": event["event_date"],
            "event_time": event["event_time"],
            "location": event["location"],
            "title": f"Reminder: {event['title']} Tomorrow",
            "event_link": f"{settings.app_public_url}/events/{event_id}",
        },
        tags=["event", "reminder"],
    )
    
    logger.info(
        f"Event reminder sent to {result['successful']} users",
        extra={
            "event_id": event_id,
            "successful": result["successful"],
            "failed": result["failed"],
            "by_source": result["by_source"],
        }
    )
```

---

## Handling Complex Templates

### Example: Multi-Part Notification with Actions

```python
from shared.novu_notifications import send_unified_notification

async def notify_payment_action_required(transaction_id: str, action: str):
    txn = await conn.fetchrow("SELECT * FROM payment_transaction WHERE id = $1", transaction_id)
    
    action_label = {
        "verify": "Verify Payment",
        "upload_receipt": "Upload Receipt",
        "retry": "Retry Payment",
    }.get(action, "View Details")
    
    action_url = {
        "verify": f"{settings.app_public_url}/admin/reconciliation/{txn['id']}",
        "upload_receipt": f"{settings.app_public_url}/checkout?txn_ref={txn['txn_ref']}",
        "retry": f"{settings.app_public_url}/payments/{txn['id']}/retry",
    }.get(action)
    
    await send_unified_notification(
        user_id=txn["user_id"],
        event_name=f"payment_{action}_required",
        payload={
            "transaction_id": str(txn["id"]),
            "amount": float(txn["amount"]),
            "currency": txn["currency"],
            "action": action,
            "action_url": action_url,
            "action_label": action_label,
            "title": f"Action Required: Payment {action.replace('_', ' ').title()}",
            "legacy_message": f"Action required on your payment: {action_label}. "
                             f"Amount: {txn['currency']} {txn['amount']}",
            "urgency": "high",  # Can be used in Novu templates for emphasis
        },
        tags=["payment", action],
    )
```

---

## Testing the Migration

### Unit Test Example

```python
# tests/test_novu_notifications.py
import pytest
from unittest.mock import AsyncMock, patch
from shared.novu_notifications import send_unified_notification

@pytest.mark.asyncio
async def test_send_unified_notification_novu_success():
    """Verify notification sent via Novu successfully"""
    with patch("shared.novu_client.get_novu_client") as mock_client:
        mock_novu = AsyncMock()
        mock_novu.send_notification.return_value = {
            "source": "novu",
            "success": True,
            "id": "novu-123",
            "data": {"id": "novu-123"}
        }
        mock_client.return_value = mock_novu
        
        result = await send_unified_notification(
            user_id="user-123",
            event_name="refund_processed",
            payload={"amount": 100, "currency": "INR", "legacy_message": "Test"},
            user_phone="+91-9999-9999",
            user_email="user@example.com",
        )
        
        assert result["source"] == "novu"
        assert result["success"] == True
        mock_novu.send_notification.assert_called_once()

@pytest.mark.asyncio
async def test_send_unified_notification_fallback_on_error():
    """Verify fallback triggered when Novu fails"""
    with patch("shared.novu_client.get_novu_client") as mock_client:
        mock_novu = AsyncMock()
        mock_novu.send_notification.return_value = {
            "source": "legacy",
            "success": True,
            "id": "legacy-fallback-user-123",
            "data": {}
        }
        mock_client.return_value = mock_novu
        
        result = await send_unified_notification(
            user_id="user-123",
            event_name="refund_processed",
            payload={"amount": 100, "legacy_message": "Test"},
            notify_sms=True,
        )
        
        assert result["source"] == "legacy"
        assert result["success"] == True
```

### Integration Test Example

```bash
#!/bin/bash
# tests/integration_test_novu.sh

# Start services
make up

# Wait for Novu to be healthy
sleep 10
curl -f http://localhost:3000/v1/health || exit 1

# Test 1: Novu active - should deliver via Novu
echo "Test 1: Novu active..."
python -c "
import asyncio
from services.payment.app.notifications import notify_refund_processed
# Test code here
"

# Test 2: Stop Novu - should fall back to legacy
echo "Test 2: Novu down..."
docker stop society_novu_api

# Repeat test - should use legacy
python -c "
import asyncio
# Test fallback
"

# Test 3: Restart Novu - should resume normal operation
echo "Test 3: Novu recovered..."
docker start society_novu_api
sleep 5

# Repeat test - should use Novu again
python -c "
import asyncio
# Test normal operation restored
"

make down
```

---

## Rollback Plan

If you need to revert to legacy-only:

1. **Stop using Novu**:
   ```bash
   NOTIFICATION_STRATEGY=legacy_only
   make restart
   ```

2. **Revert code changes** (keep the wrapper for future use):
   ```bash
   git checkout services/payment/app/notifications.py
   ```

3. **Keep Novu running** (or shut it down):
   ```bash
   # Keep running: docker-compose up -d novu-api
   # Shut down: docker-compose stop novu-api novu-worker novu-mongo novu-redis
   ```

---

## Reference

- Full guide: [NOVU_IMPLEMENTATION_GUIDE.md](NOVU_IMPLEMENTATION_GUIDE.md)
- Quick start: [NOVU_QUICK_START.md](NOVU_QUICK_START.md)
- API reference: [services/shared/novu_client.py](services/shared/novu_client.py)
- Unified wrapper: [services/shared/novu_notifications.py](services/shared/novu_notifications.py)
