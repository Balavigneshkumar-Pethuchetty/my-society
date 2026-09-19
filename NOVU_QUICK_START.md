# Novu Quick Start - Tomorrow Morning

## 1. Start Novu (8:00 AM)
```bash
cd ~/event-management
bash scripts/setup-novu.sh
```

Wait for:
- ✓ Docker Compose running
- ✓ Novu API responding on port 3000
- ✓ Dashboard accessible

## 2. Setup Dashboard (8:15 AM)
1. Go to http://localhost:3000
2. Create account
3. Login
4. **Settings → API Keys → Create New**
5. Copy API key
6. Update `.env.novu`:
   ```env
   NOVU_API_KEY=your_copied_key_here
   ```

## 3. Add Integrations (8:30 AM)

### Telegram
- Settings → Integrations → Telegram
- Paste bot token from Telegram BotFather
- Click Save

### SMS (Twilio)
- Settings → Integrations → Twilio  
- Paste Account SID, Auth Token, Phone
- Click Save

## 4. Create Templates (9:00 AM)

In Novu Dashboard, create these templates:

| Template Name | Channels | Message |
|---------------|----------|---------|
| `refund_approved` | SMS, Telegram, In-app | Refund of ₹{{amount}} {{currency}} approved |
| `refund_failed` | SMS, Telegram | Refund failed: {{reason}} |
| `user_approved` | SMS, Telegram | Your account has been approved! |
| `registration_confirmed` | SMS, Telegram | Registered for {{event_name}} |
| `ticket_issued` | SMS, Telegram, In-app | Ticket ready for {{event_name}} |
| `event_created` | Telegram | New event: {{event_name}} |
| `pass_issued` | SMS, Telegram | Visitor pass ready for {{event_name}} |

**For each template:**
1. Click "Create Workflow"
2. Name it (e.g., `refund_approved`)
3. Add channels:
   - SMS step
   - Telegram step
   - In-app step (optional)
4. Click Deploy

## 5. Update Code (1:00 PM - 4:00 PM)

### Pattern for each service:
```python
# Import
from shared.novu_client import get_novu_client
novu = get_novu_client()

# Send notification
await novu.send_notification(
    event_name="refund_approved",
    subscriber_id=user_id,
    payload={"amount": 100, "currency": "INR"},
    tags=["refund", "payment"]
)
```

### Services to update:
- [ ] services/payment/app/notifications.py
- [ ] services/user/app/notifications.py
- [ ] services/registration/app/notifications.py
- [ ] services/ticket/app/notifications.py
- [ ] services/event/app/notifications.py
- [ ] services/visitor/app/notifications.py

## 6. Deploy (4:00 PM)

```bash
# 1. Update env files
# Add NOVU_API_KEY to each service .env

# 2. Rebuild services
cd ~/event-management
make restart

# 3. Verify
make ps

# 4. Check logs for errors
make logs | grep -i error
```

## 7. Test (4:30 PM)

```bash
# Test notification
curl -X POST http://localhost:3001/v1/events/trigger \
  -H "Authorization: ApiKey $NOVU_API_KEY" \
  -d '{
    "name":"refund_approved",
    "to":{"subscriberId":"test-user"},
    "payload":{"amount":100,"currency":"INR"}
  }'
```

Verify:
- [ ] SMS received
- [ ] Telegram message received
- [ ] In-app notification appears
- [ ] Novu dashboard shows delivery

## 8. Monitor (5:00 PM)

```bash
# Check service logs
make logs | grep -i novu

# Check Novu health
make novu-test

# View Novu dashboard
# http://localhost:3000/notifications
```

---

## Rollback (If Needed)

```bash
# Stop Novu
make novu-down

# Revert code
git revert <commit>

# Rebuild
make restart
```

---

## Files Ready

All files prepared in `/home/balavigneshkumar/event-management/`:

✅ `docker-compose.novu.yml` - Novu services  
✅ `services/shared/novu_client.py` - Novu client  
✅ `.env.novu.example` - Environment template  
✅ `NOVU_MIGRATION.md` - Detailed guide  
✅ `NOVU_CHECKLIST.md` - Day-by-day checklist  
✅ `scripts/setup-novu.sh` - Setup script  

## Timeline

| Time | Task | Person |
|------|------|--------|
| 8:00 AM | Start Novu | DevOps |
| 8:15 AM | Setup API key | DevOps |
| 8:30 AM | Configure integrations | DevOps |
| 9:00 AM | Create templates | DevOps + QA |
| 1:00 PM | Update code | Backend (3 devs) |
| 4:00 PM | Deploy | DevOps |
| 4:30 PM | Test | QA |
| 5:00 PM | Monitor | On-call |

**Total: ~8 hours**

---

## Questions?

- **Setup issues?** See `NOVU_MIGRATION.md` → Setup Instructions
- **Integration issues?** Check Novu logs: `make novu-logs`
- **Service issues?** Check service logs: `make logs`
- **General help?** See `NOVU_CHECKLIST.md` for detailed timeline

Good luck tomorrow! 🚀
