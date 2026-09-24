# Current State: What Notification Service Stores

## Summary
**Short Answer**: Currently, notification-service **DOES NOT actively store notification history or payloads**. 

The database is **configured but NOT USED** for audit/history. Notifications are sent and lost.

---

## Current Architecture Analysis

### What DOES Get Stored

#### 1. **In-App Notifications (User Service)**
```python
# In main.py, endpoint /api/notifications/in-app
# Calls user-service to store notification in user-service database

# Stored in: society_events.notifications table (user-service owns it)
# Fields:
  - user_id
  - type (notification type)
  - title
  - message
  - related_id (reference to event, registration, etc.)
  - event_id
  - created_at
  - read_at (null until user reads it)
```

**Where**: User Service database (not notification-service)  
**What**: Only in-app dashboard notifications  
**Persistent**: ✅ YES (in user-service Postgres)

---

#### 2. **Logs (Console/File)**
```python
# app/notifications.py
logger.info(f"Notification sent via Novu")
logger.error(f"Novu API error: {response.status_code}")
logger.warning(f"Notification delivery failed for all channels")

# These go to:
# - Console (stdout)
# - Splunk (if SPLUNK_HEC_URL configured)
# - Application logs (Docker logs)
```

**Where**: Console logs, Splunk (optional)  
**What**: Event-level logs, not detailed audit  
**Persistent**: ⚠️ ONLY if Splunk enabled

---

### What DOES NOT Get Stored

#### 1. **Notification Payloads** ❌
```python
# Services call:
POST /api/notifications/send
{
  "user_id": "123",
  "event_name": "refund_approved",
  "payload": {           # ← THIS IS NOT STORED ANYWHERE
    "refund_id": "456",
    "amount": 5000,
    "currency": "INR"
  },
  "user_email": "user@example.com",
  "notify_email": true
}

# Flow:
# 1. receive payload
# 2. send to Novu (Novu stores it temporarily)
# 3. send to Email/SMS/Telegram
# 4. FORGET IT - no local storage
```

**Stored**: ❌ NO

---

#### 2. **Notification History (Delivery Status)** ❌
```python
# Current endpoint:
GET /api/notifications/status/{notification_id}

# What it does:
async def get_notification_status(notification_id: str):
    # Query Novu API for status
    response = await client.get(
        f"{novu_api_url}/v1/messages/notification/{notification_id}",
        headers={"Authorization": f"ApiKey {novu_api_key}"}
    )
    return response.json()

# Result: Only Novu-sent notifications can be tracked
# Email/SMS/Telegram deliveries: NO HISTORY
```

**Stored**: ❌ NO (only in Novu, if Novu used)

---

#### 3. **Failed Notification Attempts** ❌
```python
# Example failure:
if response.status_code >= 300:
    logger.error(f"Novu API error: {response.status_code}")
    return {
        "success": False,
        "source": NotificationSource.NONE,
        "id": None,
        "error": response.text  # ← Returned to caller, not stored
    }

# The error details are:
# - Returned to the service that called it
# - Logged to console/Splunk
# - NOT stored in a database for later review
```

**Stored**: ❌ NO

---

#### 4. **User Notification Preferences** ❌
```python
# Currently, ALL requests have explicit flags:
POST /api/notifications/send
{
  "notify_email": true,     # ← Must be set in each request
  "notify_sms": true,       # ← Must be set in each request
  "notify_telegram": true   # ← Must be set in each request
}

# There's NO stored user preference for:
# - Which channels they prefer?
# - Do they want notifications at all?
# - Quiet hours? Do not disturb times?
# - Frequency limits?
```

**Stored**: ❌ NO

---

## Current Database Setup (Configured but Unused)

### Configuration Exists
```python
# In config.py
db_host: str = os.getenv("DB_HOST", "pgbouncer")      # ✅ Configured
db_port: int = int(os.getenv("DB_PORT", "6432"))      # ✅ Configured
db_name: str = os.getenv("DB_NAME", "society_events") # ✅ Configured
db_user: str = os.getenv("DB_USER", "postgres")       # ✅ Configured
db_password: str = os.getenv("DB_PASSWORD", "")       # ✅ Configured
db_pool_size: int = int(os.getenv("DB_POOL_SIZE", "5")) # ✅ Configured

# In models.py
class NotificationLog(BaseModel):
    """Notification delivery log entry."""
    id: UUID
    user_id: str
    event_name: str
    source: NotificationSource
    status: NotificationStatus
    channels_sent: list[NotificationChannel]
    payload: Dict[str, Any]              # ← Model includes payload
    error_message: Optional[str] = None
    delivery_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
```

### But Code Doesn't Use It ❌
```python
# In notifications.py, send_unified_notification() function:
# - NO database import
# - NO INSERT statement
# - NO SAVE operation
# - Just sends and returns response

async def send_unified_notification(...):
    # Line 149: Try Novu
    novu_result = await send_via_novu(...)
    if novu_result["success"]:
        return SendNotificationResponse(...)  # ← Return, don't store
    
    # Line 163-209: Try legacy fallback
    # Same pattern: send, then return, don't store
    return SendNotificationResponse(...)
```

---

## What Actually Happens

### Scenario: Event Team Sends Notification

```
1. Event Service
   POST /api/notifications/send
   {
     "user_id": "123",
     "event_name": "event_published",
     "payload": {"event_id": "456", "event_name": "Tech Talk"},
     "user_email": "user@example.com",
     "notify_email": true
   }

2. Notification Service
   ├─ Validates API key ✅
   ├─ Receives payload ✅
   ├─ Sends to Novu ✅ (if configured)
   │  └─ Novu stores it temporarily
   ├─ Sends to Gmail SMTP ✅ (fallback)
   └─ Returns response ✅

3. Response Back to Event Service
   {
     "source": "novu",
     "success": true,
     "id": "novu-transaction-id",
     "data": {...}
   }

4. What Happens to Payload?
   ❌ LOST - not stored anywhere in notification-service
   ✅ Novu has it (if you query Novu API)
   ✅ Gmail sent it (but no history in Gmail)
   ❌ No local history

5. Later, Event Service Needs History:
   ❌ Can't ask notification-service
   ✅ Can ask user-service (has in-app notifications only)
   ✅ Can ask Novu (if transaction ID saved)
```

---

## Current vs. Ideal Comparison

| Aspect | Current State | Ideal State (Proposed) |
|--------|---------------|----------------------|
| **Payloads Stored** | ❌ NO | ⚠️ Optional (configurable) |
| **Delivery History** | ❌ NO | ✅ YES (configurable) |
| **Failed Attempts** | ❌ NO | ✅ YES (for debugging) |
| **User Preferences** | ❌ NO | ✅ YES (optional) |
| **Audit Trail** | ⚠️ Logs only | ✅ YES (Splunk/local) |
| **Status Tracking** | ⚠️ Novu only | ✅ All channels |
| **Data Persistence** | ❌ Transient | ✅ Durable (configurable) |
| **Database Used** | ⚠️ Configured, unused | ✅ Only if enabled |
| **Independent** | ✅ Doesn't store anything | ✅ YES (stateless) |

---

## Why Nothing Gets Stored Currently?

### Design Reason 1: Stateless Service
```
Design Philosophy:
  - Notification-service should be lightweight
  - Just send and forget
  - Let Novu handle history (if using Novu)
  - No persistence = can scale horizontally
  - Can run multiple instances independently
```

### Design Reason 2: Services Handle Their Own History
```
If Event Service needs to track notifications:
  Event Service could store it locally
  ├─ Keep a notifications_sent table
  ├─ Link to events table
  └─ Track delivery status separately

If User Service needs in-app notifications:
  User Service stores them
  └─ notifications table (already exists)

Split responsibility:
  - notification-service: delivery only
  - other services: history tracking
```

### Design Reason 3: Novu is Primary
```
Architecture:
  Notification Service ──→ Novu
                           (Novu stores everything)
                           (Novu tracks delivery)
                           (Novu provides history)

So "why duplicate in notification-service?"
```

---

## What Services Currently Have

### Event Service
```
Table: events
Fields:
  - id
  - name
  - description
  - start_date
  - created_at

Does NOT have:
  ❌ notifications_sent table
  ❌ notification_history
  ❌ delivery_status tracking
```

### User Service
```
Table: notifications (in-app only)
Fields:
  - id
  - user_id
  - type (e.g., "event_published")
  - title
  - message
  - related_id (event_id, registration_id, etc.)
  - created_at
  - read_at

Limitations:
  ⚠️ Only for in-app notifications
  ⚠️ Doesn't track email/SMS delivery
  ⚠️ Doesn't store payloads
```

### Notification Service
```
Database Configured BUT:
  ❌ No actual tables created
  ❌ No ORM models defined
  ❌ No INSERT/UPDATE queries
  ❌ Just configuration that's never used
```

---

## If You Want to Store History (Options)

### Option A: Notification-Service Stores It
```
Pros:
  ✅ Centralized history
  ✅ Cross-service notification audit
  ✅ Easy to query "all notifications sent"
  
Cons:
  ❌ Makes service stateful
  ❌ Adds database dependency
  ❌ Complicates independent deployment
  ❌ Complexity (what to store, retention)
```

### Option B: Calling Service Stores It
```
Example: Event Service tracks its own notifications

Event Service:
  CREATE TABLE event_notifications (
    id UUID PRIMARY KEY,
    event_id UUID FK,
    user_id UUID,
    notification_type VARCHAR,
    payload JSONB,
    sent_via VARCHAR (novu/email/sms),
    status VARCHAR (sent/failed/pending),
    created_at TIMESTAMP,
    delivered_at TIMESTAMP
  );

Pros:
  ✅ Keeps notification-service stateless
  ✅ Each service owns its notification history
  ✅ Easier independence
  
Cons:
  ❌ Duplicated code across services
  ❌ Can't query cross-service history easily
```

### Option C: Hybrid (Redis Cache Only)
```
Notification Service stores in Redis (temporary):
  - Key: "notifications:sent:{date}"
  - Value: Compressed notification details
  - TTL: 24-48 hours
  - Used for: Debug recent deliveries

Pros:
  ✅ Fast (in-memory)
  ✅ Lightweight
  ✅ Automatic cleanup
  ✅ No persistence
  
Cons:
  ⚠️ Still a dependency (Redis)
  ❌ Lost on service restart
```

### Option D: Event Log / Message Queue
```
Use event streaming (Kafka / EventHub):
  Event Service → "notification.sent" event → Event Bus
  Notification Service → publishes events → Event Bus
  
  Then:
  - Analytics service consumes → reports
  - Audit service consumes → compliance
  - Any service can subscribe to notification events

Pros:
  ✅ Decoupled
  ✅ Auditable
  ✅ Scalable
  
Cons:
  ❌ Adds event infrastructure
  ❌ More complex
```

---

## Current Data Flow Diagram

```
Service (Event)
    │
    │ POST /api/notifications/send
    │ {user_id, event_name, payload, user_email, ...}
    ↓
Notification Service (Stateless)
    │
    ├─→ [Validate API Key]
    │
    ├─→ [Send to Novu] ──→ Novu (stores it)
    │                      └─→ Can query later
    │
    ├─→ [Send to Email] ──→ Gmail SMTP
    │                      (no storage)
    │
    ├─→ [Send to SMS/Telegram] ──→ Auth Service
    │                             (no storage)
    │
    └─→ [Return Response] ──→ Service
        {success: true, ...}

    ❌ NOWHERE: Local notification-service storage
    ❌ NOWHERE: Local database history
    ❌ NOWHERE: Payload preservation
```

---

## Summary Table

```
What's Stored?                          Where?          Type
───────────────────────────────────────────────────────────────
Novu notification (if Novu used)        Novu servers    External
Email (sent via Gmail)                  Gmail servers   External
SMS/Telegram (via auth-service)         Auth-service    External
In-app notifications                    User-service    Local DB
Console logs                            stdout/Splunk   External
Error messages                          logs            Transient

What's NOT Stored Anywhere:
───────────────────────────────────────────────────────────────
Request payloads                        ❌              
Delivery status history                 ❌              
Failed attempt records                  ❌              
User preferences                        ❌              
Notification metrics                    ❌              
```

---

## Implications

### Positive (Why Stateless is Good)
✅ Notification-service is truly independent  
✅ No database dependency  
✅ Can scale horizontally  
✅ Can run without Keycloak, Postgres  
✅ Simple, fast, reliable for just sending  

### Negative (Why Stateless is Limited)
❌ No "did we send this notification?" history  
❌ No debugging (why did it fail?)  
❌ No user complaint resolution ("I didn't get my notification")  
❌ No analytics (how many notifications sent?)  
❌ No retry mechanism (failed deliveries are lost)  
❌ No idempotency (can send duplicate notifications)  

---

## Recommendation for Your Architecture

### As-Is (Current, Stateless)
```
Best for:
  ✅ Development/testing
  ✅ Simple deployments
  ✅ Fire-and-forget notifications
  
Problems:
  ❌ No history
  ❌ No debugging
  ❌ No idempotency
```

### With Optional Audit (Recommended)
```
// This is what I proposed in NOTIFICATION_SERVICE_INDEPENDENCE_ANALYSIS.md

Feature-flagged storage:
  USE_AUDIT=true
  AUDIT_BACKEND=redis   # or sqlite, or splunk, or none
  
With audit:
  ✅ Keep stateless core
  ✅ Add optional history
  ✅ Still independent
  ✅ Can disable if not needed
  
Implementation effort: Medium (2-3 weeks)
```

---

## Conclusion

**Current State**: 
- ✅ Notification-service is stateless (truly independent)
- ❌ NO notification history stored
- ❌ NO payload preservation
- ❌ NO delivery tracking (except Novu)
- ⚠️ Database configured but unused

**For Your Independence Goals**:
- ✅ Current approach is GOOD (no Postgres dependency)
- ❌ But adds operational blind spots
- ⚠️ Consider optional audit layer (Redis/SQLite)

**Next Step**: 
If you want history + independence, implement the plan from NOTIFICATION_SERVICE_INDEPENDENCE_ANALYSIS.md with optional audit storage.
