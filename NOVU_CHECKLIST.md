# Novu Migration - Day 1 Checklist

**Date:** 2026-09-20  
**Team:** 2-3 people  
**Duration:** 6-8 hours

---

## Morning (8 AM - 12 PM) - Setup Phase

### Setup (Team Lead / DevOps)
- [ ] **8:00** Start Novu services
  ```bash
  cd ~/event-management
  make novu-setup
  ```
- [ ] **8:15** Verify all Novu containers running
  ```bash
  make novu-ps
  ```
- [ ] **8:20** Access Novu dashboard
  - Go to http://localhost:3000
  - Create account
  - Login

### API Key & Configuration (Team Lead)
- [ ] **8:30** Create API key in Novu
  - Settings → API Keys → Create New
  - Copy key to clipboard
  - Update `.env.novu` with key
- [ ] **8:45** Configure Telegram integration
  - Settings → Integrations → Telegram
  - Paste bot token
  - Enable
- [ ] **9:00** Configure SMS (Twilio)
  - Settings → Integrations → Twilio
  - Add Account SID, Auth Token, Phone
  - Enable

### Create Templates (Team Lead / QA)
- [ ] **9:15** Create `refund_approved` template
  - Add SMS channel: "Refund of {{amount}} {{currency}} approved"
  - Add Telegram: "✅ Refund of ₹{{amount}} approved"
  - Add In-app: "Your refund has been approved!"
  - Test template with sample data

- [ ] **9:35** Create `refund_failed` template
  - SMS: "Refund failed: {{reason}}"
  - Telegram: "❌ Refund failed: {{reason}}"
  
- [ ] **9:45** Create `user_approved` template
  - SMS: "Account approved!"
  - Telegram: "✅ Your account has been approved!"
  
- [ ] **9:55** Create `registration_confirmed` template
  - SMS: "Registration confirmed for {{event_name}}"
  - Telegram: "📝 Registered for {{event_name}}"
  
- [ ] **10:05** Create `ticket_issued` template
  - SMS: "Ticket ready for {{event_name}}"
  - Telegram: "🎟 Your ticket is ready!"
  
- [ ] **10:15** Create `event_created` template
  - Telegram: "📅 New event: {{event_name}}"

- [ ] **10:25** Create `pass_issued` template
  - SMS: "Visitor pass ready for {{event_name}}"
  - Telegram: "🎫 Pass issued for {{event_name}}"

### Verification (Team Lead)
- [ ] **10:35** Test notification delivery
  ```bash
  curl -X POST http://localhost:3001/v1/events/trigger \
    -H "Authorization: ApiKey $NOVU_API_KEY" \
    -d '{"name":"refund_approved","to":{"subscriberId":"test-123"},"payload":{"amount":100,"currency":"INR"}}'
  ```
- [ ] **10:45** Verify SMS received
- [ ] **10:50** Verify Telegram received
- [ ] **10:55** Verify in-app notification (create test endpoint)

---

## Afternoon (1 PM - 5 PM) - Migration Phase

### Backend Developer 1: Payment & User Services

- [ ] **1:00** Update payment-service notifications
  - [ ] Install dependencies: `pip install novu httpx`
  - [ ] Create notifications.py using new pattern
  - [ ] Update all refund notifications
  - [ ] Update all payment notifications
  - [ ] Test locally

- [ ] **2:00** Update user-service notifications
  - [ ] Install dependencies
  - [ ] Update user approval notifications
  - [ ] Update user rejection notifications
  - [ ] Test locally

### Backend Developer 2: Registration, Ticket, Event Services

- [ ] **1:00** Update registration-service notifications
  - [ ] Install dependencies
  - [ ] Update registration confirmed notifications
  - [ ] Update payment pending notifications
  - [ ] Test locally

- [ ] **2:00** Update ticket-service notifications
  - [ ] Install dependencies
  - [ ] Update ticket issued notifications
  - [ ] Update ticket cancelled notifications
  - [ ] Test locally

- [ ] **3:00** Update event-service notifications
  - [ ] Install dependencies
  - [ ] Update event created notifications
  - [ ] Test locally

### Backend Developer 3 (or 2): Visitor & Utilities

- [ ] **3:00** Update visitor-service notifications
  - [ ] Install dependencies
  - [ ] Update pass issued notifications
  - [ ] Update pass scanned notifications
  - [ ] Test locally

- [ ] **3:30** Add Novu client to shared
  - [ ] Verify `services/shared/novu_client.py` exists
  - [ ] Test client singleton pattern
  - [ ] Add to shared requirements

### QA / Testing (Throughout)

- [ ] **1:00 onwards** Unit test each service
  - [ ] Payment service notification tests
  - [ ] User service notification tests
  - [ ] Registration service tests
  - [ ] Ticket service tests
  - [ ] Event service tests
  - [ ] Visitor service tests

- [ ] **3:00** Integration testing
  - [ ] Refund flow: trigger → SMS → check
  - [ ] User approval: trigger → Telegram → check
  - [ ] Event creation: trigger → in-app → check
  - [ ] Ticket issuance: trigger → notification → check

### Deployment (DevOps)

- [ ] **4:00** Update environment files
  - [ ] Add NOVU_API_KEY to each service .env
  - [ ] Add NOVU_BASE_URL to each service .env
  - [ ] Verify all services have keys

- [ ] **4:15** Rebuild all services
  ```bash
  make restart
  ```

- [ ] **4:30** Verify services started
  ```bash
  make ps
  docker logs payment-service | grep -i novu
  ```

- [ ] **4:45** Health checks
  - [ ] Payment service healthy ✓
  - [ ] User service healthy ✓
  - [ ] Registration service healthy ✓
  - [ ] Ticket service healthy ✓
  - [ ] Event service healthy ✓
  - [ ] Visitor service healthy ✓

- [ ] **5:00** Smoke tests
  - [ ] Trigger refund notification
  - [ ] Check SMS received
  - [ ] Check Telegram received
  - [ ] Check in-app notification
  - [ ] Check Novu dashboard shows delivery

---

## Evening (5 PM - 6 PM) - Monitoring & Wrap Up

### Post-Deployment (On-Call)

- [ ] **5:00** Monitor services for errors
  ```bash
  make logs | grep -i error
  ```

- [ ] **5:10** Check Splunk for notification logs
  - [ ] Verify notification events logged
  - [ ] Check for any failures

- [ ] **5:20** Test all notification flows
  - [ ] Manual refund test
  - [ ] Manual approval test
  - [ ] Check all channels received

- [ ] **5:30** Document any issues
  - [ ] Note any failures
  - [ ] Document workarounds
  - [ ] Plan fixes for day 2

- [ ] **5:45** Team debrief
  - [ ] What went well
  - [ ] What needs improvement
  - [ ] Assign day 2 cleanup tasks

---

## Known Issues & Fixes

| Issue | Fix | Status |
|-------|-----|--------|
| Novu API slow to start | Wait 30-60s | Known |
| MongoDB connection timeout | Restart Novu | Workaround |
| Old code still running | Rebuild services | Standard |
| Telegram not receiving | Check bot token | Check |
| SMS not receiving | Check Twilio credentials | Check |

---

## Critical Paths

### If Running Behind Schedule
- Skip in-app notifications (add next)
- Deploy payment + user services first
- Others in parallel
- Full system restart at end

### If Issues Found
- Check Novu logs: `make novu-logs`
- Check service logs: `make logs`
- Rollback if needed: See NOVU_MIGRATION.md

### Day 2 Tasks
- [ ] Clean up old notification code
- [ ] Remove send_sms(), send_telegram() functions
- [ ] Update documentation
- [ ] 24-hour monitoring

---

## Success Criteria

✅ **All services restarted successfully**  
✅ **All notifications send to Novu**  
✅ **SMS delivered to users**  
✅ **Telegram messages received**  
✅ **In-app notifications appear**  
✅ **Novu dashboard shows all deliveries**  
✅ **No errors in service logs**  
✅ **All tests passing**

---

## Quick Commands

```bash
# Start fresh
make novu-setup

# View status
make novu-ps
make ps

# View logs
make novu-logs
make logs

# Test connectivity
make novu-test

# Rebuild everything
make restart

# Run specific service logs
docker logs payment-service -f
```

---

## Contact

- **Issues:** Check Novu logs first (`make novu-logs`)
- **Help:** See NOVU_MIGRATION.md for detailed guide
- **Rollback:** See NOVU_MIGRATION.md rollback section

Good luck! 🚀
