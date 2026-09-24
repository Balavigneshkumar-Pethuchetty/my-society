# Team Independence Quick Reference

## The Vision
Enable teams to work independently on their services with minimal dependencies, while maintaining code privacy and enabling selective monetization.

---

## 1. Service Tiers at a Glance

### 🔴 Tier 1: Core Platform (Always Required)
```
PostgreSQL + Redis + pgBouncer  (Shared database infrastructure)
                ↓
        auth-service (external in ~/auth-service)
        user-service (port 3001)
        Nginx (reverse proxy)
```

**Every team must run these**. Think of it as the foundation.

### 🟡 Tier 2: Deployable Services (Pick & Choose)

| Service | Best For | Runs Standalone? | Owns | Depends On |
|---------|----------|------------------|------|------------|
| **event** | Event management team | ✅ Yes | Events, categories | Core only |
| **ticket** | QR & scanning team | ⚠️ With event | Tickets, QR codes | core + event |
| **registration** | Checkout flow team | ⚠️ With event | Registrations, carts | core + event |
| **payment** | Payment reconciliation | ⚠️ With registration | UPI, refunds | core + event + registration |
| **visitor** | Visitor tracking team | ✅ Yes (own DB) | Visitor data | Core + own Postgres |
| **notification** | Notification team | ✅ Yes (optional) | SMS, email, Novu | Core only |

---

## 2. Docker Compose Profiles (Run What You Need)

### Command Examples

```bash
# Event team: just core + event service
docker compose --profile event up -d

# Payment team: core + registration + payment
docker compose --profile checkout up -d

# Full stack (all services)
docker compose --profile event --profile checkout --profile visitor --profile notifications up -d

# Minimal (just core)
docker compose up -d
```

### Profile Mapping
```yaml
--profile event          →  event-service, ticket-service
--profile checkout       →  registration-service, payment-service
--profile visitor        →  visitor-service (own Postgres)
--profile notifications  →  notification-service
```

---

## 3. Environment Variables by Team

### What Each Team Sets

**Event Team's .env**:
```bash
# Minimal (core + event)
POSTGRES_DB=society_events
POSTGRES_USER=...
POSTGRES_PASSWORD=...
KEYCLOAK_URL=https://auth.your-domain.com
INTERNAL_API_KEY=...

# Event-specific
GMAIL_SMTP_USER=...        # For event notifications
GMAIL_APP_PASSWORD=...
```

**Payment Team's .env**:
```bash
# Same core vars + registration + payment
PAYMENT_SECRET_KEY=...         # Encrypt IMAP passwords
ANTHROPIC_API_KEY=...          # For email parsing
PAYMENT_SERVICE_ENV=testing    # or production
```

**Visitor Team's .env**:
```bash
# Same core vars + visitor-specific
VISITOR_POSTGRES_USER=...
VISITOR_POSTGRES_PASSWORD=...
VISITOR_POSTGRES_DB=visitor_service
```

---

## 4. File Structure for Team Independence

```
services/event/
├── docker-compose.yml              ← Standalone config
├── .env.example                    ← All variables
├── .env.example.minimal            ← Just what's needed
├── .env.example.with-ticket        ← Event + ticket
├── ONBOARDING.md                   ← Quick start
├── API_CONTRACTS.md                ← What I consume/provide
├── README.md
├── Dockerfile
└── app/
    ├── main.py
    ├── routes/
    ├── models.py
    └── tests/

services/payment/
├── docker-compose.yml
├── .env.example
├── .env.example.minimal
├── .env.example.with-registration
├── ONBOARDING.md
├── API_CONTRACTS.md
└── ...
```

**Every service gets**:
- ✅ Standalone `docker-compose.yml`
- ✅ Multiple `.env.example.*` files (minimal → full)
- ✅ `ONBOARDING.md` (5-minute quick start)
- ✅ `API_CONTRACTS.md` (what it needs, what it provides)
- ✅ `README.md` (overview & development guide)

---

## 5. Code Privacy & External Developer Handoff

### Private vs. Public Services

**Public (everyone can see)**:
- `services/shared/` — Utilities, models, middleware
- `services/user/` — Foundation service
- `db/` — Database schema
- Documentation & guides

**Private (need permission)**:
- `services/event/` — Private git repo (if sensitive)
- `services/payment/` — Private (financial data)
- `services/visitor/` — Private (visitor tracking)
- `frontend/` — (if confidential UX)

### Handoff to External Developer

1. **Create private repo** for their service:
   ```
   society-event-service (external)
   ```

2. **Grant access to**:
   - `services/shared/` (read-only)
   - `services/user/` (read-only, for API contracts)
   - `db/migrations/` (read-only, for schema)
   - `.env.example` (their service's only)

3. **Deny access to**:
   - `services/payment/`, `services/visitor/` (other services)
   - Prod credentials, API keys
   - Frontend code (if confidential)

4. **Document**:
   - API contracts they depend on
   - Database tables they touch
   - Expected error codes
   - Support contact

---

## 6. Monetization Framework

### License Tier Strategy

```
Free Tier (Always Available):
  ✅ user-service
  ✅ event-service
  ✅ ticket-service
  ✅ Basic notifications

Premium Tier (Opt-in, Paid):
  🔒 payment-service (UPI reconciliation)
  🔒 visitor-service (visitor tracking)
  🔒 Advanced notifications (Novu, email, Telegram)
  🔒 Analytics service
```

### How It Works

```python
# In service startup
LICENSE_TIER = os.getenv("LICENSE_TIER", "free")  # free, basic, premium

if LICENSE_TIER not in ["basic", "premium"]:
    raise Exception("This service requires PREMIUM license")
    # Service won't start without proper license
```

**Docker Compose**:
```yaml
payment-service:
  profiles: [premium]  # Only starts with --profile premium
  environment:
    LICENSE_TIER: ${LICENSE_TIER}
```

---

## 7. Team Workflows

### Event Team Day-to-Day

```bash
# Clone repo
git clone https://github.com/yourorg/my-society.git

# Navigate to their service
cd services/event

# Copy minimal environment
cp .env.example.minimal .env
# Edit .env with local values

# Start services (core + event only)
docker-compose -f ../../docker-compose.core.yml \
              -f docker-compose.yml \
              up -d

# Develop on a feature branch
git checkout -b feature/event-filtering
# Edit services/event/app/routes/events.py
# Test: pytest tests/

# When ready, test with dependent services
cp .env.example.with-ticket .env
docker-compose --profile ticket up -d
pytest tests/integration/

# Push feature branch
git push origin feature/event-filtering
# Core team reviews & merges
```

### New Team Onboarding

**Day 1**:
1. Receive access to `society-event-service` repo
2. Read `ONBOARDING.md` (5 minutes)
3. Copy `.env.example.minimal` → `.env`
4. Run `docker-compose up -d`
5. Verify: `curl http://localhost:3002/health`

**Day 2-5**: Start feature development

**Week 2**: Test integration with other services

**Week 3**: Merge to main, core team deploys to staging

---

## 8. CI/CD Per-Service Pipeline

```
.github/workflows/event-service.yml

Triggers on:
  - Push to services/event/**
  - Push to services/shared/**  (rebuild if dependency changes)
  - Push to db/migrations/**

Pipeline:
  1. Build Docker image
  2. Run pytest (unit + integration)
  3. Push to registry
  4. Deploy to dev environment
  5. Run smoke tests
```

**Dependency Awareness**:
```yaml
on:
  push:
    paths:
      - 'services/event/**'
      - 'services/shared/**'   # Rebuild if shared changes!
      - 'db/migrations/**'     # Rebuild if schema changes!
```

---

## 9. API Contracts Example

### Event Service Publishes

```markdown
# Event Service API Contract

## Endpoints I Provide
- GET  /api/events/{id}
- POST /api/events
- GET  /api/events/{id}/registrations

## Endpoints I Consume
- GET  /api/users/{id}           (user-service)
- POST /api/notifications/send   (notification-service)

## Event Topics (Async)
- event.created
- event.published
- event.cancelled

## Database Schema
- Table: events
  - Columns: id, name, category_id, start_date, end_date
  - PK: id
  - FK: category_id → event_categories.id
  
## Considerations
- All endpoints require Bearer token (Keycloak JWT)
- Dates are UTC ISO-8601
- Max registrations per event: configurable
```

---

## 10. Dependency Graph (Visual)

```
┌─────────────────────────────────────┐
│  Core Platform (All teams)          │
│  PostgreSQL + Redis + Auth + User   │
└─────────────────────────────────────┘
         ↑                  ↑
    ┌────┴────┐        ┌────┴────┐
    │          │        │         │
 ┌──▼──┐   ┌──▼──┐  ┌──▼──┐  ┌──▼──┐
 │Event│   │Visitor│ │Notif│  │(Opt)│
 │Team │   │ Team  │ │ Team│  └─────┘
 └──┬──┘   └──────┘ └─────┘
    │
    ├─ Ticket Team (depends on Event)
    │
    ├─ Registration Team (depends on Event)
    │
    └─ Payment Team (depends on Registration)
```

**Key Rule**: Lower services don't depend on higher ones.
- Ticket can depend on Event ✅
- Event cannot depend on Ticket ❌

---

## 11. Checklist: Is a Service Ready for Team Independence?

- [ ] Has standalone `docker-compose.yml`
- [ ] Has `.env.example.minimal` file
- [ ] Has `ONBOARDING.md` with 5-minute quick start
- [ ] Has `API_CONTRACTS.md` (dependencies + what it provides)
- [ ] Has `README.md` with development guide
- [ ] Has startup health checks (validates dependencies)
- [ ] Has test suite (can run without full stack)
- [ ] No hardcoded service URLs (all in .env)
- [ ] Separate GitHub Actions workflow
- [ ] License tier check (if monetized)

---

## 12. Common Scenarios

### Scenario 1: Event Team Wants to Test with Tickets

```bash
# Currently running: core + event
# Add ticket service

# Step 1: Get ticket .env
cp services/ticket/.env.example.minimal .env.ticket

# Step 2: Extend docker-compose
docker-compose -f docker-compose.core.yml \
              -f services/event/docker-compose.yml \
              -f services/ticket/docker-compose.yml \
              --env-file .env.ticket \
              up -d

# Step 3: Test integration
pytest tests/integration/test_event_ticket_flow.py
```

### Scenario 2: Payment Team Debugging IMAP Issue

```bash
# They only have payment service running
# Issue: IMAP connection fails in production
# Solution: Pull payment logs

docker logs <payment-service-container>

# They can debug without running event, visitor, ticket services
# Just core + payment needed
```

### Scenario 3: Handing Code to External Developer

```bash
# Step 1: Create private repo
git@github.com:external-agency/society-event-service.git

# Step 2: Grant access (GitHub settings)
# - Read-only to services/shared/
# - Read-only to db/migrations/
# - Full access to services/event/ (in their private repo)

# Step 3: Share documentation
# - ONBOARDING.md
# - API_CONTRACTS.md
# - .env.example.minimal
# - DATABASE_SCHEMA.md

# Step 4: They start development
git clone git@github.com:external-agency/society-event-service.git
# ... develop for 2 weeks ...
# ... send PR to main repo for review ...
```

---

## 13. Implementation Priority

### Week 1-2: Setup
- [ ] Create docker-compose profiles
- [ ] Write .env.example.* files per service
- [ ] Create ONBOARDING.md per service

### Week 3-4: Isolation
- [ ] Extract shared code → `services/shared/`
- [ ] Update imports across services
- [ ] Test standalone startup for each service

### Week 5+: Team Enablement
- [ ] Onboard first pilot team
- [ ] Write API_CONTRACTS.md
- [ ] Set up separate CI/CD pipelines
- [ ] Document monetization policy

---

## 14. Key Takeaways

| Aspect | Benefit | How |
|--------|---------|-----|
| **Developer Experience** | Teams only clone/run what they need | Docker profiles + .env.example.minimal |
| **Code Privacy** | Selective code sharing to external devs | Git submodules + access control |
| **Scalability** | Parallel team workflows | Clear service boundaries + API contracts |
| **Monetization** | Free vs. paid services | LICENSE_TIER env var + docker profiles |
| **Maintenance** | Easy to support multiple deployments | Separate CI/CD + per-service documentation |
| **Onboarding** | New teams start in hours, not days | ONBOARDING.md + pre-configured .env files |

---

## 15. Next Action Items

1. **Review** this plan with your team
2. **Choose** one pilot service (suggest: event-service)
3. **Implement** steps 1-2 of roadmap
4. **Test** with a sample external developer
5. **Iterate** based on feedback
6. **Rollout** to other services

---

## Support Docs

- 📖 `SERVICE_INDEPENDENCE_PLAN.md` — Full strategic plan
- 📖 `ENV_STRUCTURE.md` — Environment variable organization
- 📖 `ENV_MIGRATION_GUIDE.md` — How to migrate .env files
- 📖 `ARCHITECTURE.md` — Current system architecture (if exists)

---

**Questions?** Reference the main `SERVICE_INDEPENDENCE_PLAN.md` for detailed explanations.
