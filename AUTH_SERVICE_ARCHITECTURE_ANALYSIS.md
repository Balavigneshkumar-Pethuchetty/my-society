# Auth Service Architecture Analysis

## Question
**Should auth-service be:**
1. Part of my-society monorepo (services/auth)?
2. Completely separate repo (~/auth-service)?
3. External SaaS (Keycloak-as-a-Service)?

**Context**: Auth is critical for event-service, user-service, payment-service, and future services (car parking, CCTV).

---

## Current State Analysis

### Today's Setup (Separate Repo)
```
~/auth-service/                    ← Separate sibling project
├── cloudflared/                   ← Cloudflare tunnel
├── podman-compose.yml             ← Podman, not Docker
├── Keycloak
├── auth-service backend
└── OAuth2 integration
    
~/my-society/                      ← Main project
├── services/event/
├── services/user/
├── services/payment/
└── references ~/auth-service via KEYCLOAK_URL
```

**Current Dependency Model**:
```
my-society services
        ↓
KEYCLOAK_URL env var
        ↓
https://auth.gm-global-techies-town.club
        ↓
~/auth-service (separate project)
        ↓
Cloudflare tunnel
```

---

## Three Architecture Options

### Option A: Keep Separate Repo (Current)

**Structure**:
```
~/auth-service/              ← Separate sibling
  ├── Keycloak (OpenID provider)
  ├── OAuth2 endpoints
  ├── User management
  ├── Realm configuration
  └── Cloudflare tunnel

~/my-society/                ← Main application
  ├── services/
  ├── db/
  ├── frontend/
  └── Calls auth-service via KEYCLOAK_URL
```

**Pros** ✅:
- ✅ Auth is truly independent
- ✅ Can scale auth separately
- ✅ Can update auth without touching app
- ✅ Shared by multiple projects (if you have more)
- ✅ Clear separation of concerns
- ✅ Auth doesn't get tangled with app logic
- ✅ Easier to share auth with third-party apps
- ✅ Can use different orchestration (podman vs. docker)
- ✅ Lower cognitive load (one project = one concern)

**Cons** ❌:
- ❌ Two separate repos to manage
- ❌ Two separate deployments
- ❌ Requires coordination (if you update Keycloak)
- ❌ Two .env files to manage
- ❌ Two separate CI/CD pipelines
- ❌ New developer needs to clone two repos
- ❌ Slightly more complex local setup

**Best For**:
- ✅ Production environments
- ✅ Multiple projects sharing auth
- ✅ Dedicated auth team
- ✅ Auth should be stable and independent
- ✅ Your current situation (small team, multiple apps)

---

### Option B: Part of my-society Monorepo

**Structure**:
```
~/my-society/
├── services/
│   ├── auth/              ← NEW: Auth service
│   │   ├── keycloak/
│   │   ├── app/           ← Backend (Python/Node)
│   │   └── docker-compose.yml
│   ├── event/
│   ├── user/
│   └── payment/
├── db/
├── docker-compose.yml     ← Orchestrates everything
└── cloudflared/           ← Tunnel now in main repo
```

**Pros** ✅:
- ✅ Single repo (easier for new developers)
- ✅ Single docker-compose.yml (one command: `make up`)
- ✅ Single .env file
- ✅ Coordinated deployments
- ✅ Same git history
- ✅ Easy to see dependencies
- ✅ Easier for small teams

**Cons** ❌:
- ❌ Auth gets tangled with application code
- ❌ Can't scale auth independently
- ❌ Auth can't be shared with other projects
- ❌ Larger repo (slower clones)
- ❌ Complex docker-compose.yml
- ❌ Auth changes affect entire project
- ❌ Harder to test auth independently
- ❌ Not suitable for multi-team setup
- ❌ Violates single-responsibility principle

**Best For**:
- ✅ Monolithic architecture
- ✅ Single project, single team
- ✅ Auth unlikely to be reused
- ✅ Quick local development
- ❌ NOT suitable for your goals

---

### Option C: External SaaS (Keycloak Cloud, Auth0)

**Structure**:
```
~/auth-service/            ← Gone (uses SaaS)
  
~/my-society/
  └── KEYCLOAK_URL=https://your-keycloak-cloud-provider.com
      (No local auth infrastructure)
```

**Pros** ✅:
- ✅ Zero infrastructure to manage
- ✅ Automatically scaled
- ✅ No deployment worries
- ✅ Professional support
- ✅ Enterprise features included
- ✅ Global uptime SLA

**Cons** ❌:
- ❌ Costs money ($100-500+/month)
- ❌ Vendor lock-in
- ❌ Internet dependency (offline development harder)
- ❌ Data leaves your infrastructure
- ❌ Less control
- ❌ Network latency

**Best For**:
- ✅ Large production environments
- ✅ When infrastructure cost is not issue
- ✅ When you want managed service
- ❌ NOT for bootstrapping phase

---

## Decision Matrix

| Criteria | Separate Repo | In Monorepo | SaaS |
|----------|---------------|------------|------|
| **Simplicity** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Independence** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ |
| **Scalability** | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Reusability** | ⭐⭐⭐⭐⭐ | ❌ | ⭐⭐⭐ |
| **Cost** | $0 | $0 | $$$ |
| **Control** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **Dev Friction** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Team Size** | For larger | For smaller | For large |

---

## Your Specific Context

### Current Services
```
my-society/
├── event-service       (Needs auth)
├── user-service        (Needs auth)
├── payment-service     (Needs auth)
├── ticket-service      (Needs auth)
├── registration-service (Needs auth)
├── visitor-service     (Needs auth)
└── notification-service (Needs auth - optional)

Future Services
├── car-parking-service (Will need auth)
├── cctv-service        (Will need auth)
└── other services?     (Will need auth)
```

### Key Question: Can Auth Be Shared?

**Scenario 1: Single Project (Only my-society)**
```
my-society/
  └── All services use same auth
  
Would work in monorepo ✅ OR separate repo ✅
```

**Scenario 2: Multiple Projects (my-society + others)**
```
my-society/
  └── All services + car-parking + CCTV

car-parking-system/ (different project, different repo)
  └── Also needs same auth

external-vendor-app/
  └── Also needs access to auth
  
In this case:
  ❌ Monorepo (can't share)
  ✅ Separate repo (can share)
  ✅ SaaS (can share)
```

**Scenario 3: Multiple Teams
```
Team A: Works on event, registration, payment
Team B: Works on car-parking
Team C: Works on CCTV
Team D: Manages auth (DevOps team)

Would need:
  ✅ Separate auth repo (owned by Team D)
  ❌ Monorepo (too large, too many teams)
```

---

## Auth Service Dependencies Analysis

### What Auth Service Does
```
Keycloak
├─ User authentication (login/logout)
├─ OAuth2 token generation
├─ JWT token validation (JWKS endpoint)
├─ User roles management
├─ User realm management
├─ Multi-factor authentication (optional)
├─ Social login (Google, etc.)
└─ Session management
```

### How It's Used by Other Services
```
Event Service
  ├─ Validates JWT on each request
  ├─ Checks user.realm_access.roles
  ├─ Calls KEYCLOAK_URL/realms/society-events/protocol/openid-connect/certs (JWKS)
  └─ Doesn't need event database, just token validation

Payment Service
  ├─ Same JWT validation
  ├─ Gets user roles from token
  └─ No direct calls to auth-service

User Service
  ├─ Validates JWT
  ├─ Creates/updates user records
  ├─ Links Keycloak user_id to local user
  └─ Sometimes calls auth-service for new user creation

Notification Service
  ├─ Validates JWT (for dashboard endpoints)
  ├─ Uses API key (for internal service calls)
  └─ No calls to Keycloak
```

### Dependency Model
```
All Services ─→ KEYCLOAK_URL ─→ auth-service ─→ Keycloak

Critical: Auth-service MUST BE RUNNING for:
  ✅ User login (Keycloak)
  ✅ JWT validation (JWKS endpoint)
  ⚠️ User creation (optional)
  
Services can work offline if:
  - They already have valid JWT
  - They cache JWKS (public keys)
  - They don't validate new logins
```

---

## Recommendation: Which Option for Your Case?

### Phase 1 (NOW): Separate Repo ✅ BEST

**Why**:
1. ✅ You already have it separate (auth-service)
2. ✅ Allows car-parking, CCTV to use same auth
3. ✅ Auth doesn't get mixed with application code
4. ✅ Allows future sharing with third parties
5. ✅ Easier to manage independently
6. ✅ Supports team growth (can have auth team)
7. ✅ Can scale auth independently

**Implementation**:
```
Keep as-is:
  ~/auth-service/ (separate)
  ~/my-society/ (separate)
  ~/car-parking/ (future, can also use auth-service)
  ~/cctv-service/ (future, can also use auth-service)
  
All reference:
  KEYCLOAK_URL=https://auth.gm-global-techies-town.club
```

**Local Development**:
```
# Developer needs to clone both:
git clone ~/auth-service
git clone ~/my-society

# Start both:
cd ~/auth-service && podman-compose up -d
cd ~/my-society && docker-compose up -d

# OR: Create convenience script
make start-all  # Starts both projects
```

---

### Phase 2 (Future, If Needed): Consider SaaS

**When**:
- Team grows to 20+ people
- Multiple projects (5+)
- Production deployment at scale
- Compliance/security requirements
- Need enterprise Keycloak features

**Example**: Migrate to Keycloak Cloud or Auth0
```
Set: KEYCLOAK_URL=https://keycloak-cloud-provider.com

Remove: ~/auth-service completely
Result: No local auth infrastructure to manage
```

---

## Migration Paths

### Path 1: Separate → Monorepo (Not Recommended)
```
If later you decide to merge into monorepo:

Step 1: Copy ~/auth-service into ~/my-society/services/auth
Step 2: Update docker-compose.yml
Step 3: Update all references
Step 4: Delete ~/auth-service repo
Step 5: Coordinate with all teams

Effort: High, Risky ❌
```

### Path 2: Separate → SaaS (Easy)
```
If later you want managed service:

Step 1: Set KEYCLOAK_URL to SaaS provider
Step 2: Migrate users/realms (one-time)
Step 3: Delete ~/auth-service deployment
Step 4: Pay monthly fee

Effort: Low, Safe ✅
Reversible: No (data migration)
```

### Path 3: Separate → Stays Separate (Recommended)
```
Just keep growing:
  ~/auth-service (grows, gets better)
  ~/my-society (grows, gets more services)
  ~/car-parking (new project, uses same auth)
  ~/cctv (new project, uses same auth)

All reference same Keycloak instance
All managed independently
All deployable separately

Effort: None, Safe ✅
Reversible: Always
```

---

## How to Manage Two Repos (Developer Experience)

### Setup (First Time)
```bash
# Clone both
git clone ~/auth-service
git clone ~/my-society

# Create convenience startup
cat > ~/start-all.sh
#!/bin/bash
cd ~/auth-service && podman-compose up -d
cd ~/my-society && docker-compose up -d
echo "Both services running"
```

### Daily Development
```bash
# Option 1: Start everything
./start-all.sh

# Option 2: Start just my-society (if auth already running)
cd ~/my-society && docker-compose up -d

# Option 3: Use make targets
make start-auth    # Start auth-service
make start-app     # Start my-society
make restart-all   # Restart everything
```

### CI/CD
```
.github/workflows/

my-society.yml
  ├─ Builds my-society
  ├─ Runs tests (mocks auth-service)
  ├─ Deploys to staging/prod
  └─ Doesn't deploy auth

auth-service.yml (separate repo)
  ├─ Builds auth-service
  ├─ Tests Keycloak config
  ├─ Deploys separately
  └─ Independent schedule
```

### Environment Variables
```
# my-society/.env
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
(Points to auth-service, wherever it's deployed)

# auth-service/.env
KEYCLOAK_ADMIN_PASSWORD=...
(Manages Keycloak internally)

# Both can be in separate .env files
# No duplication needed
```

---

## Shared Infrastructure Services Pattern

### Services That SHOULD Be Separate
```
Auth Service ✅
  Why: Used by multiple projects
  Multiple instances: No (single source of truth)
  
Shared Database ✅
  Why: Multiple services read/write
  Multiple instances: No (must coordinate)
  
Notification Service ✅ (from your analysis)
  Why: Multiple services call it
  Multiple instances: Yes (can scale)
```

### Services That Can Be In Monorepo or Separate
```
Event Service ⚠️
  If: Only my-society uses it
  Then: Can be in monorepo
  
  If: Car-parking also needs events
  Then: Make separate (shared events service)
```

---

## Car Parking & CCTV Services Future

### Scenario: You Later Add Car Parking Service

```
Option A: Separate repo (Recommended)
~/car-parking/
  ├─ car-parking-service
  ├─ parking-payment-service
  ├─ parking-analytics-service
  └─ KEYCLOAK_URL=https://auth.gm-global-techies-town.club
     (Points to same auth)

Advantages:
  ✅ Independent team can manage
  ✅ Independent deployment
  ✅ Shares auth infrastructure
  ✅ Shares user database (optional)
```

### Scenario: You Later Add CCTV Service

```
Option A: Separate repo
~/cctv/
  ├─ cctv-service
  ├─ analytics-service
  ├─ alerting-service
  └─ KEYCLOAK_URL=https://auth.gm-global-techies-town.club
     (Same auth)

All three projects (my-society, car-parking, cctv):
  ✅ Use same Keycloak
  ✅ Have same users
  ✅ Have role-based access
```

---

## Architecture Diagram (Recommended)

```
                    ┌─────────────────────────┐
                    │   Cloudflare Tunnel     │
                    │   (Public Internet)     │
                    └────────────┬────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
                ↓                ↓                ↓
    ┌──────────────────┐  ┌────────────┐  ┌────────────┐
    │  my-society      │  │car-parking │  │   CCTV     │
    │  (Event mgmt)    │  │(Parking)   │  │(Monitoring)│
    └──────────────────┘  └────────────┘  └────────────┘
           │                    │                │
           │    All reference:  │                │
           └────────┬───────────┴────────────────┘
                    │
        KEYCLOAK_URL=https://auth.xxx.com
                    │
                    ↓
    ┌──────────────────────────────────────┐
    │      ~/auth-service (Separate)       │
    │  ├─ Keycloak                         │
    │  ├─ OAuth2 Endpoint                  │
    │  ├─ User Management                  │
    │  └─ Cloudflare Tunnel Integration    │
    └──────────────────────────────────────┘
            Manages:
            ├─ Users
            ├─ Roles
            ├─ Realms
            └─ Authentication
```

---

## Summary & Recommendation

### KEEP SEPARATE REPO (Recommended) ✅

**For now**:
```
~/auth-service/          (Separate, independent)
  ├─ Manages Keycloak
  ├─ Handles authentication
  └─ Used by all projects

~/my-society/            (Separate, application)
  ├─ All services
  ├─ References auth-service
  └─ Independent deployment
```

**Benefits**:
- ✅ True independence (different teams, different schedules)
- ✅ Can share with car-parking, CCTV, future projects
- ✅ Auth doesn't get tangled with business logic
- ✅ Can scale auth independently
- ✅ Can upgrade Keycloak independently
- ✅ Supports team growth

**Developer Experience**:
- ⚠️ Need to clone 2 repos
- ✅ But: Create make targets for easy setup
- ✅ Each team owns their repo

**Future Options**:
- 📈 If scale: Migrate to SaaS (Keycloak Cloud)
- 🔧 If constraints: Move to monorepo (but harder later)
- 📊 If multi-org: Keep separate (required)

---

## Action Items

### Right Now
- ✅ Keep ~/auth-service separate
- ✅ Improve ~/my-society independence (already in progress)
- ✅ Create make targets for both repos

### When Car Parking / CCTV Added
- ✅ Create ~/car-parking separate repo
- ✅ Point to same KEYCLOAK_URL
- ✅ Reuse auth-service

### When at Scale (100+ users, multiple teams)
- ⏳ Consider Keycloak Cloud
- ⏳ Or: Hire DevOps team to manage auth-service professionally
