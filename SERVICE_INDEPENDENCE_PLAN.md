# Service Independence & Team Segregation Plan

## Executive Summary

This plan enables your microservices architecture to support:
- **Team Independence**: Teams develop only their assigned services without running the entire stack
- **Code Privacy**: Selective code sharing to external developers (piece by piece)
- **Modular Deployment**: Pick and choose which services to run/deploy
- **Monetization**: Free vs. paid service tiers
- **Easy Maintenance**: Clear dependencies and minimal coupling

---

## 1. Service Dependency Hierarchy

### Tier 1: Core Platform (Mandatory for Any Service)
These services are **required by all other services**:

```
┌─────────────────────────────────────────┐
│  PostgreSQL + Redis + pgBouncer         │
│  (Shared database infrastructure)       │
└─────────────────────────────────────────┘
         ↑         ↑         ↑
         │         │         │
    ┌────┴────┬────┴────┬────┴────┐
    │          │         │         │
 ┌──▼──┐   ┌──▼──┐  ┌──▼──┐  ┌──▼──┐
 │Auth │   │User │  │Event│  │Notif│
 │     │   │     │  │     │  │     │
 └─────┘   └─────┘  └─────┘  └─────┘
```

**Core Platform Services** (must run):
- `auth-service` (external in `~/auth-service`) — Keycloak/JWT
- `user-service` (port 3001) — User data, roles, building structure
- PostgreSQL main DB (`society_postgres`)
- Redis cache
- pgBouncer connection pool
- Nginx (minimal reverse proxy)

### Tier 2: Independently Deployable Services

**Optional services** can run standalone or together, depending on business needs:

```
┌─────────────────────────────────────┐
│  Core Platform (Tier 1)             │
└─────────────────────────────────────┘
         ↑
    ┌────┴─────────────────────────┐
    │                              │
┌───▼────┐  ┌──────┐  ┌─────────┐  │  ┌────────┐
│ Event  │  │Ticket│  │Payment  │  │  │ Visitor│
│ Service│  │Svc   │  │Svc      │  │  │ Svc    │
└────┬───┘  └──┬───┘  └────┬────┘  │  └────────┘
     │         │           │       │
     └─────────┴─────┬─────┘       │
                     │             │
              ┌──────▼──────┐      │
              │Registration │      │
              │Service      │      │
              └──────┬──────┘      │
                     │             │
              ┌──────▼──────┐      │
              │Notification │◄─────┘
              │Service      │
              └─────────────┘
```

### Service Dependency Matrix

```
Service              | Required Core | Depends On | Can Run Standalone?
─────────────────────┼──────────────┼────────────┼──────────────────
auth-service         | Yes (external)| —          | Yes (separate repo)
user-service         | Yes          | auth       | Yes
event-service        | Yes          | auth, user | Yes (partial)
ticket-service       | Yes          | auth, user,| Yes (with event)
                     |              | event      |
registration-service | Yes          | auth, user,| Yes (partial)
                     |              | event      |
payment-service      | Yes          | auth, user,| Yes (partial)
                     |              | registration|
visitor-service      | Yes (own DB) | auth, user | Yes (own instance)
notification-service | Yes          | auth, user | Yes (optional)
nginx                | Minimal      | —          | Yes (lightweight)
```

---

## 2. Team Development Profiles

### Profile A: Event Team
**Goal**: Develop event management features

**What they install**:
```
Required:
✓ PostgreSQL + Redis + pgBouncer
✓ auth-service (~/auth-service) — just to validate tokens
✓ user-service — to fetch user data
✓ Nginx (basic proxy)

Their service:
✓ event-service

Optional (for testing):
◇ ticket-service — to test ticket creation flow
◇ notification-service — to test event notifications
```

**What they DON'T need**:
- payment-service (money handling)
- visitor-service (separate domain)
- registration-service (unless testing full checkout)

**Startup command**:
```bash
# In event-service repo
docker-compose -f docker-compose.core.yml \
              -f docker-compose.event.yml \
              up -d
```

### Profile B: Payment Team
**Goal**: Develop payment reconciliation & refunds

**What they install**:
```
Required:
✓ PostgreSQL + Redis + pgBouncer
✓ auth-service
✓ user-service
✓ registration-service — to create test registrations
✓ Nginx

Their service:
✓ payment-service

Optional (for testing):
◇ notification-service — to test refund notifications
◇ event-service — to create test events for registrations
```

**What they DON'T need**:
- ticket-service (issuance is downstream)
- visitor-service (separate domain)

**Startup command**:
```bash
docker-compose -f docker-compose.core.yml \
              -f docker-compose.payment.yml \
              up -d
```

### Profile C: Ticket & QR Team
**Goal**: Develop ticket issuance, QR codes, gate scanning

**What they install**:
```
Required:
✓ PostgreSQL + Redis + pgBouncer
✓ auth-service
✓ user-service
✓ event-service — to create events
✓ Nginx

Their service:
✓ ticket-service

Optional:
◇ registration-service — to create test registrations
◇ notification-service — to test ticket QR delivery
```

**What they DON'T need**:
- payment-service (payment is upstream)
- visitor-service (separate domain)

---

## 3. Docker Compose Profile Architecture

### Approach: Compose Profiles + Selective Inclusion

**Restructure root `docker-compose.yml`**:

```yaml
version: '3.8'

# Core Platform: always starts
services:
  society_postgres:
    profiles: []  # No profile = always starts
    
  redis:
    profiles: []
    
  pgbouncer:
    profiles: []
    
  nginx:
    profiles: []
    
  user-service:
    profiles: []  # Mandatory for all

# Event ecosystem
  event-service:
    profiles: [event]  # Start with: --profile event
    depends_on:
      - society_postgres
      - user-service
      - auth-service (reference via network)
    
  ticket-service:
    profiles: [event, ticket]  # Part of event profile OR run standalone
    depends_on:
      - event-service
      - user-service

# Payment ecosystem
  registration-service:
    profiles: [checkout, payment]
    depends_on:
      - event-service
      - user-service
      
  payment-service:
    profiles: [checkout, payment]
    depends_on:
      - registration-service
      - user-service

# Visitor ecosystem (own Postgres)
  visitor-postgres:
    profiles: [visitor]
    
  visitor-service:
    profiles: [visitor]
    depends_on:
      - visitor-postgres
      - user-service

# Notifications (optional, used by multiple)
  notification-service:
    profiles: [notifications]
    depends_on:
      - user-service
```

### Usage Examples:

```bash
# Event team: Core + Event services only
docker compose --profile event up -d

# Payment team: Core + Payment/Checkout services
docker compose --profile checkout up -d

# Full stack (all services)
docker compose --profile event --profile checkout --profile visitor --profile notifications up -d

# Minimal (just core platform)
docker compose up -d
```

---

## 4. Service Repository Structure

### Monorepo vs. Polyrepo Decision

**Recommendation**: **Hybrid Monorepo**

```
my-society/
├── services/
│   ├── shared/              # Shared code (models, utils, auth helpers)
│   │   ├── __init__.py
│   │   ├── models.py        # SQLAlchemy models
│   │   ├── schemas.py       # Pydantic validators
│   │   ├── middleware/      # JWT validation, auth helpers
│   │   └── exceptions.py    # Custom exceptions
│   │
│   ├── user/
│   │   ├── Dockerfile
│   │   ├── docker-compose.yml
│   │   ├── .env.example
│   │   ├── app/
│   │   │   ├── settings.py
│   │   │   ├── main.py
│   │   │   └── routes/
│   │   └── README.md
│   │
│   ├── event/
│   │   ├── Dockerfile
│   │   ├── docker-compose.yml
│   │   ├── .env.example
│   │   ├── app/
│   │   └── README.md
│   │
│   ├── ticket/
│   ├── registration/
│   ├── payment/
│   ├── visitor/
│   └── notification/
│
├── docker-compose.yml       # Root: defines profiles
├── docker-compose.core.yml  # Separate: just Postgres, Redis, auth
├── db/
│   ├── init/
│   ├── migrations/
│   └── .env.example
├── nginx/
├── frontend/
├── .env.example
└── ENV_STRUCTURE.md
```

### Per-Service README Structure

Each service gets a **README.md** with:

```markdown
# Event Service

## Quick Start (Standalone)
```bash
docker-compose up -d
```

## What This Service Does
- Event CRUD operations
- Event categories
- Ticket type management

## Dependencies
- PostgreSQL (main shared DB)
- User Service (for role validation)
- Keycloak (for JWT validation)

## Standalone vs. Full Stack
- **Standalone**: Works with test data, limited features
- **Full Stack**: Connect to real user, payment, ticket services

## API Contracts
- Consumes: `/api/users/{id}` from user-service
- Publishes: `/api/events/*` — used by ticket-service, registration-service

## Environment Setup
See `.env.example` for required variables

## Testing
\`\`\`bash
# Unit tests (no external deps)
pytest tests/unit

# Integration tests (requires PostgreSQL)
pytest tests/integration

# Full stack tests (requires docker-compose up)
pytest tests/e2e
\`\`\`
```

---

## 5. Environment Configuration per Team

### Approach: Tiered .env.example Files

**Structure**:
```
services/event/
├── .env.example                    # All possible variables
├── .env.example.minimal            # Just what event-service needs
├── .env.example.with-ticket        # Event + ticket integration
└── .env.example.full-stack         # All services

services/payment/
├── .env.example
├── .env.example.minimal            # Payment only
├── .env.example.with-registration  # Payment + registration
└── .env.example.full-stack
```

**Usage**:
```bash
# Event team starts minimal
cp services/event/.env.example.minimal .env
docker-compose up -d

# Later, if they want to test with tickets
cp services/event/.env.example.with-ticket .env
docker-compose --profile ticket up -d
```

### Environment Variable Tiers

**Tier 1: Core (All teams must set)**
```
POSTGRES_DB=society_events
POSTGRES_USER=
POSTGRES_PASSWORD=
KEYCLOAK_URL=https://auth.your-domain.com
INTERNAL_API_KEY=
```

**Tier 2: Service-specific (Only needed if running that service)**
```
# Event-specific
SOCIETY_UPI_ID=
SOCIETY_UPI_NAME=
GMAIL_SMTP_USER=

# Payment-specific
PAYMENT_SECRET_KEY=
ANTHROPIC_API_KEY=
```

**Tier 3: Optional (Nice to have, not critical)**
```
SPLUNK_HEC_TOKEN=      # Monitoring
NOVU_API_KEY=          # Notifications
```

---

## 6. Code Privacy & Selective Sharing

### Strategy: Git Submodules + Permissions

```
my-society/ (Public/Core)
├── services/
│   ├── shared/              # Public (reusable utilities)
│   └── user/                # Public (foundational service)
│
├── services/event/          # Private (git submodule)
│   └── .git (separate repo)
│
├── services/payment/        # Private (git submodule)
│   └── .git (separate repo)
│
├── services/visitor/        # Private (git submodule)
│   └── .git (separate repo)
│
└── .gitmodules
    [submodule "services/event"]
        path = services/event
        url = https://github.com/yourorg/society-event-service.git
        branch = main
```

### Access Control Model

| Team | Repository Access | Can See Code | Can Deploy | Can Modify |
|------|-------------------|--------------|-----------|-----------|
| Event | society-event-service | ✓ Event only | ✓ To dev/staging | ✓ Event files |
| Payment | society-payment-service | ✓ Payment only | ✓ To dev/staging | ✓ Payment files |
| Visitor | society-visitor-service | ✓ Visitor only | ✓ To dev/staging | ✓ Visitor files |
| Core Team | my-society (main) | ✓ Everything | ✓ To prod | ✓ Everything |
| External Dev | Specific submodule | ✓ One service | ✗ | ✓ One service |

### Handoff Process for External Developers

```
1. Create private repository for the service
   → society-event-service-external
   
2. Grant read-only access to:
   - services/shared/          (public utilities)
   - services/user/            (for API contracts)
   - db/migrations/            (schema they touch)
   - Relevant .env.example
   
3. Deny access to:
   - services/payment/
   - services/visitor/
   - Frontend code (if confidential)
   - Prod credentials
   
4. Document API contracts they depend on
   
5. Review code before merging back to main
```

---

## 7. Monetization Strategy

### Free vs. Paid Services

**Free Services** (always available):
- user-service — Core identity
- event-service — Event management
- ticket-service — Ticket issuance & QR
- Notification basics (SMS)

**Paid/Premium Services** (opt-in):
- payment-service — "Premium UPI reconciliation"
- advanced-notifications — "Novu + email + Telegram"
- visitor-management — "Visitor tracking & compliance"
- advanced-analytics — "Event attendance analytics"

**Architecture for Monetization**:

```yaml
# docker-compose.yml
services:
  event-service:
    profiles: []  # Always included
    
  payment-service:
    profiles: [premium]  # Only with license key
    environment:
      LICENSE_TIER: ${LICENSE_TIER}  # free, basic, premium
    
  visitor-service:
    profiles: [premium]
    environment:
      LICENSE_TIER: ${LICENSE_TIER}
```

**License check in code**:
```python
# services/payment/app/settings.py
from enum import Enum

class LicenseTier(str, Enum):
    FREE = "free"
    BASIC = "basic"
    PREMIUM = "premium"

LICENSE_TIER = LicenseTier(os.getenv("LICENSE_TIER", "free"))

if LICENSE_TIER not in [LicenseTier.BASIC, LicenseTier.PREMIUM]:
    raise Exception("Payment service requires PREMIUM license")
```

---

## 8. Onboarding & Documentation

### Per-Team Onboarding Guide

**Structure**:
```
services/event/
├── ONBOARDING.md
│   ├── 5-minute quick start
│   ├── Prerequisites checklist
│   ├── How to run standalone
│   ├── How to integrate with other services
│   ├── Common gotchas
│   └── Support contacts
│
├── API_CONTRACT.md
│   ├── What I consume (user-service endpoints)
│   ├── What I provide (event-service endpoints)
│   ├── Event-ticket integration points
│   └── Error codes
│
├── DATABASE_SCHEMA.md
│   ├── Tables owned by this service
│   ├── Foreign keys to other services
│   ├── Indexes for performance
│   └── Backup/restore procedures
│
└── DEPLOYMENT.md
    ├── Dev environment
    ├── Staging environment
    ├── Production rollout
    └── Rollback procedures
```

### Shared Knowledge Base

```
docs/
├── ARCHITECTURE.md              # Overall system design
├── SERVICE_INDEPENDENCE_PLAN.md # This document
├── API_CONTRACTS.md             # All service endpoints
├── DATABASE_SCHEMA.md           # Full ERD + relationships
├── DEPLOYMENT_GUIDE.md          # How to deploy each service
├── SECURITY_GUIDELINES.md       # PII handling, secrets mgmt
├── TEAM_WORKFLOWS.md            # Branch naming, CI/CD
└── TROUBLESHOOTING.md           # Common issues & fixes
```

---

## 9. CI/CD Considerations

### Separate Pipelines per Service

```
.github/workflows/
├── event-service.yml          # Trigger: changes in services/event/
│   ├── Build Docker image
│   ├── Run tests
│   ├── Push to registry
│   └── Deploy to dev/staging
│
├── payment-service.yml        # Trigger: changes in services/payment/
├── ticket-service.yml
├── shared-library.yml         # Trigger: changes in services/shared/
│   └── Rebuild ALL services (shared changed)
│
└── integration-tests.yml      # Trigger: changes in services/ or db/
    └── Run full-stack tests
```

### Dependency Awareness

```yaml
# .github/workflows/event-service.yml
on:
  push:
    paths:
      - 'services/event/**'
      - 'services/shared/**'  # Rebuilds if shared changes
      - 'db/migrations/**'
```

---

## 10. Database Schema Isolation

### Per-Service Schema (Optional Evolution)

**Current state** (shared schema):
```sql
-- All tables in public schema
-- Services read/write any table (by convention)
```

**Future state** (optional, for stronger isolation):
```sql
-- Separate schemas per service
CREATE SCHEMA event_service;
CREATE SCHEMA payment_service;
CREATE SCHEMA user_service;

-- Tables partitioned by schema
event_service.events
event_service.event_categories
payment_service.payment_transaction
payment_service.refund_queue
user_service.users
```

**Benefits**:
- Stronger data isolation
- Clear ownership
- Easier to split databases later

**Trade-offs**:
- More complex migrations
- Need separate DB roles per schema

---

## 11. Service Communication Patterns

### Recommended: Synchronous HTTP + Event Bus (Async)

```
Synchronous (HTTP):
  Event Service → User Service (fetch user details)
  Ticket Service → Event Service (fetch event info)

Asynchronous (Event Bus/Kafka):
  Event created → Publish "event.created" event
  Notification Service subscribes → Send notifications
  
  Payment approved → Publish "payment.approved"
  Ticket Service subscribes → Issue tickets
```

### API Contracts Documentation

**Each service publishes**:
```markdown
# Event Service API

## Endpoints I Provide
- `GET /api/events/{id}` — Get event details
- `POST /api/events` — Create event
- `GET /api/events/{id}/registrations` — List registrations

## Endpoints I Consume
- `GET /api/users/{id}` (user-service) — Get user data
- `POST /api/notifications/send` (notification-service) — Send event notifications

## Event Topics I Publish (Async)
- `event.created` — When an event is created
- `event.updated` — When event details change
- `event.published` — When event is published
```

---

## 12. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- [ ] Document current service dependencies
- [ ] Create tiered .env.example files per service
- [ ] Set up docker-compose profiles
- [ ] Write per-service README + ONBOARDING.md

### Phase 2: Isolation (Weeks 3-4)
- [ ] Extract common code into services/shared/
- [ ] Update imports across all services
- [ ] Add environment variable validation per service
- [ ] Create standalone docker-compose files per service
- [ ] Test each service startup independently

### Phase 3: Team Enablement (Week 5)
- [ ] Create team-specific .env.example files
- [ ] Write API_CONTRACTS.md
- [ ] Set up git submodules for private services (optional)
- [ ] Run onboarding with sample team
- [ ] Document gotchas learned

### Phase 4: CI/CD (Week 6+)
- [ ] Separate GitHub Actions workflows per service
- [ ] Implement dependency detection (shared/ changes)
- [ ] Set up staging environments per team profile
- [ ] Document deployment procedures

---

## 13. Checklist for Team Independence

### For Each Service, Ensure:

- [ ] **Standalone docker-compose.yml** in service folder
- [ ] **.env.example.minimal** with only required variables
- [ ] **README.md** with 5-minute quick start
- [ ] **ONBOARDING.md** with setup instructions
- [ ] **API_CONTRACTS.md** documenting dependencies
- [ ] **Separate GitHub Actions** workflow
- [ ] **License tier checks** (if monetized)
- [ ] **No hardcoded URLs** to other services — all in env vars
- [ ] **Startup health checks** — service validates deps are reachable
- [ ] **Test suite** that runs standalone (mocks external services)

### For the Main Repo, Ensure:

- [ ] **docker-compose.yml** with service profiles
- [ ] **docker-compose.core.yml** (Postgres, Redis, Nginx only)
- [ ] **docs/ARCHITECTURE.md** showing dependency graph
- [ ] **docs/API_CONTRACTS.md** aggregated
- [ ] **docs/DEPLOYMENT_GUIDE.md** per-team instructions
- [ ] **docs/ONBOARDING_TEAMS.md** for new teams
- [ ] **Shared code** in services/shared/ (models, utilities, middleware)
- [ ] **.gitignore** properly structured

---

## 14. Example: Event Team Workflow

### Day 1: Onboarding
```bash
# Event team clones repo
git clone https://github.com/yourorg/my-society.git
cd my-society/services/event

# Read onboarding
cat ONBOARDING.md

# Copy minimal environment
cp .env.example.minimal .env
# Edit .env with their test values

# Start services
docker-compose -f ../../docker-compose.core.yml \
              -f docker-compose.yml \
              up -d

# Verify
curl http://localhost:3002/api/events/health
```

### Week 1: Feature Development
```bash
# They only modify services/event/
git checkout -b feature/event-filtering
# Edit: services/event/app/routes/events.py
# Edit: services/event/app/models.py
# Add: services/event/tests/test_filtering.py

# Run tests
pytest tests/

# Commit
git add services/event/
git commit -m "feat: add event filtering by category"

# Push to feature branch
git push origin feature/event-filtering
```

### Week 2: Integration Testing
```bash
# Now test with other services
cp services/event/.env.example.with-ticket .env

# Start with ticket service too
docker-compose -f docker-compose.core.yml \
              -f services/event/docker-compose.yml \
              -f services/ticket/docker-compose.yml \
              up -d

# Run integration tests
pytest tests/integration/

# Everything works? Open PR
# Core team reviews → merges → deploys to staging
```

---

## 15. Risk Mitigation

### Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| **Duplicate code** | Enforce shared/ folder usage + code reviews |
| **Broken dependencies** | Shared models versioning + CI tests |
| **Database migrations** | Centralized migration versioning in db/migrations/ |
| **Secret leaks** | .env in .gitignore + git hooks to prevent secrets |
| **Inconsistent APIs** | API_CONTRACTS.md + automated endpoint testing |
| **Team stepping on each other** | Clear service ownership + separate feature branches |
| **External dev misuse** | Limited git access + license enforcement at runtime |

---

## Summary: Team Independence Benefits

✅ **Developers**
- Clone only what they need
- Shorter startup times
- Clear scope & boundaries
- Reduced context switching

✅ **Managers**
- Parallel team workflows
- Clear project progress
- Privacy control over code
- Easy onboarding/offboarding

✅ **Business**
- Selective monetization
- Scalable team growth
- Reduced deployment risk
- IP protection

✅ **DevOps**
- Simplified deployments
- Per-service scaling
- Cleaner CI/CD pipelines
- Easier troubleshooting

---

## Next Steps

1. **Review** this plan with your team
2. **Pilot** with one service (suggest: event-service)
3. **Document** learnings → update plan
4. **Rollout** to other services
5. **Train** teams on new workflow

---

## References

- See: `ENV_STRUCTURE.md` — Environment variable organization
- See: `ENV_MIGRATION_GUIDE.md` — How to migrate from monolithic .env
- See: `ARCHITECTURE.md` — Current service architecture (if exists)
