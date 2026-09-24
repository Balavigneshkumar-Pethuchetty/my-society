# Environment Variables: What Belongs Where?

## The Problem You've Identified

Currently, Keycloak variables are in BOTH repos:

```
my-society/.env
├─ KEYCLOAK_URL
├─ KEYCLOAK_PUBLIC_URL
├─ KEYCLOAK_ADMIN_USER
├─ KEYCLOAK_ADMIN_PASSWORD
├─ KEYCLOAK_DB
└─ KEYCLOAK_API_CLIENT_SECRET

auth-service/.env
├─ KEYCLOAK_ADMIN_USER
├─ KEYCLOAK_ADMIN_PASSWORD
├─ KEYCLOAK_PORT
├─ KEYCLOAK_DB
├─ KEYCLOAK_API_CLIENT_SECRET
└─ (same variables duplicated!)
```

**Question**: Why duplicate? Why not keep ALL Keycloak vars in auth-service only?

**Answer**: You're 100% right! ✅ This is a DUPLICATION PROBLEM.

---

## Analysis: What Each Repo Actually Needs

### What my-society ACTUALLY Needs from Keycloak

```python
# services/user/app/middleware/auth.py
async def validate_jwt(token: str):
    # Only needs:
    jwks_url = f"{KEYCLOAK_URL}/realms/society-events/protocol/openid-connect/certs"
    return validate_token(token, jwks_url)

# services/event/app/routes/events.py
keycloak_url = os.getenv("KEYCLOAK_URL")  # Only this!
keycloak_public_url = os.getenv("KEYCLOAK_PUBLIC_URL")  # Only this! (for frontend)
```

**my-society NEEDS**:
- ✅ `KEYCLOAK_URL` (for JWT validation)
- ✅ `KEYCLOAK_PUBLIC_URL` (for frontend login)
- ✅ `KEYCLOAK_REALM` (to construct paths)

**my-society does NOT need**:
- ❌ `KEYCLOAK_ADMIN_USER`
- ❌ `KEYCLOAK_ADMIN_PASSWORD`
- ❌ `KEYCLOAK_DB`
- ❌ `KEYCLOAK_API_CLIENT_SECRET`
- ❌ `KEYCLOAK_PORT`

---

### What auth-service ACTUALLY Needs

```python
# auth-service/app/config.py
class Settings:
    keycloak_admin_user = os.getenv("KEYCLOAK_ADMIN_USER")
    keycloak_admin_password = os.getenv("KEYCLOAK_ADMIN_PASSWORD")
    keycloak_db = os.getenv("KEYCLOAK_DB")
    keycloak_api_client_secret = os.getenv("KEYCLOAK_API_CLIENT_SECRET")
    keycloak_port = os.getenv("KEYCLOAK_PORT")
    # etc.
```

**auth-service NEEDS**:
- ✅ `KEYCLOAK_ADMIN_USER` (to manage Keycloak)
- ✅ `KEYCLOAK_ADMIN_PASSWORD` (to manage Keycloak)
- ✅ `KEYCLOAK_DB` (Keycloak's own database)
- ✅ `KEYCLOAK_API_CLIENT_SECRET` (OAuth2 secret)
- ✅ `KEYCLOAK_PORT` (where Keycloak runs)

**auth-service EXPOSES TO WORLD**:
- ✅ `https://auth.gm-global-techies-town.club` (via Cloudflare)

---

## Current Problematic Setup

```
my-society/.env
├─ KEYCLOAK_URL=https://auth.xxx.com ✅ Used
├─ KEYCLOAK_PUBLIC_URL=https://auth.xxx.com ✅ Used
├─ KEYCLOAK_ADMIN_USER=admin ❌ Not used (why here?)
├─ KEYCLOAK_ADMIN_PASSWORD=... ❌ Not used (why here?)
├─ KEYCLOAK_DB=keycloak ❌ Not used (why here?)
└─ KEYCLOAK_API_CLIENT_SECRET=... ❌ Not used (why here?)

auth-service/.env
├─ KEYCLOAK_ADMIN_USER=admin ✅ Used
├─ KEYCLOAK_ADMIN_PASSWORD=... ✅ Used
├─ KEYCLOAK_DB=keycloak ✅ Used
└─ KEYCLOAK_API_CLIENT_SECRET=... ✅ Used
```

**Problem**: 
- ❌ Duplication (same vars in two places)
- ❌ Confusion (which is the source of truth?)
- ❌ Risk (if you update one, forget the other)
- ❌ Noise (my-society has vars it doesn't use)

---

## Recommended Separation

### auth-service/.env (Complete Control)
```bash
# Keycloak Admin
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=your-secure-password
KEYCLOAK_PORT=8081

# Keycloak Database
KEYCLOAK_DB=keycloak
POSTGRES_USER=keycloak_user
POSTGRES_PASSWORD=keycloak_password

# OAuth2 / API Secrets
KEYCLOAK_API_CLIENT_SECRET=your-secret-min-32-chars
KEYCLOAK_REALM=society-events

# Cloudflare Tunnel (auth-service owns it)
CLOUDFLARE_TUNNEL_TOKEN=...
CLOUDFLARE_TUNNEL_CONFIG_URL=...

# Public URL (what my-society points to)
PUBLIC_KEYCLOAK_URL=https://auth.gm-global-techies-town.club
```

**Only auth-service cares about these!** ✅

---

### my-society/.env (Minimal Keycloak Info)
```bash
# Root .env (only what my-society needs)

# Keycloak URLs (provided by auth-service)
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_REALM=society-events

# That's it! ✅
# (No admin credentials, no database info, no secrets)
```

**Only my-society services use these!** ✅

---

## Dependency Flow (Cleaner)

### Current (Problematic)
```
my-society/.env
  ├─ KEYCLOAK_URL (used) ✅
  ├─ KEYCLOAK_ADMIN_USER (not used) ❌
  ├─ KEYCLOAK_ADMIN_PASSWORD (not used) ❌
  ├─ KEYCLOAK_DB (not used) ❌
  └─ KEYCLOAK_API_CLIENT_SECRET (not used) ❌
        ↓
    services/user → validates JWT using KEYCLOAK_URL only
    services/event → validates JWT using KEYCLOAK_URL only

auth-service/.env
  ├─ KEYCLOAK_ADMIN_USER (used) ✅
  ├─ KEYCLOAK_ADMIN_PASSWORD (used) ✅
  ├─ KEYCLOAK_DB (used) ✅
  └─ KEYCLOAK_API_CLIENT_SECRET (used) ✅
        ↓
    Keycloak runs, exposes public endpoint
        ↓
    https://auth.gm-global-techies-town.club (via Cloudflare)
        ↓
    (my-society points to this PUBLIC URL)
```

---

### Recommended (Clean)

```
auth-service/.env (Complete, secret, admin-level)
  ├─ KEYCLOAK_ADMIN_USER ✅
  ├─ KEYCLOAK_ADMIN_PASSWORD ✅
  ├─ KEYCLOAK_DB ✅
  ├─ KEYCLOAK_API_CLIENT_SECRET ✅
  └─ PUBLIC_KEYCLOAK_URL ← Publishes this
        ↓
    Keycloak runs
        ↓
    Exposes: https://auth.gm-global-techies-town.club (via Cloudflare)


my-society/.env (Simple, only public URLs)
  ├─ KEYCLOAK_URL=https://auth.gm-global-techies-town.club ✅
  └─ KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club ✅
        ↓
    services/user → validates JWT
    services/event → validates JWT
    (All point to public URL)
```

**Key Insight**: my-society NEVER needs auth-service's SECRETS ✅

---

## Why Keycloak Vars in my-society Currently?

### Reason 1: Convenience
```
Developers clone my-society and see:
  "Oh, Keycloak config is here, let me setup Keycloak too"
  
Problem: They modify variables thinking it affects Keycloak
But Keycloak is in separate repo!
```

### Reason 2: Copy-Paste from Template
```
Original setup probably had everything in one .env
Then split repos but didn't clean up vars
Now both have copies
```

### Reason 3: Uncertain Ownership
```
"Should Keycloak vars be in application repo or auth repo?"
Answer: ✅ Always in auth-service repo!
```

---

## What Should Be Where

### auth-service/.env (SECRETS - Never Commit)
```bash
# === Keycloak Management (auth-service responsibility) ===
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=super-secure-password-min-32-chars
KEYCLOAK_PORT=8081

# === Keycloak Database (auth-service responsibility) ===
KEYCLOAK_DB=keycloak
KEYCLOAK_POSTGRES_USER=keycloak
KEYCLOAK_POSTGRES_PASSWORD=keycloak-db-password
KEYCLOAK_POSTGRES_DB=keycloak

# === OAuth2 Secrets (auth-service responsibility) ===
KEYCLOAK_API_CLIENT_SECRET=long-random-secret-min-32-chars
KEYCLOAK_REALM=society-events

# === Public URL (what others point to) ===
PUBLIC_KEYCLOAK_URL=https://auth.gm-global-techies-town.club

# === Cloudflare Tunnel (auth-service responsibility) ===
CLOUDFLARE_TUNNEL_NAME=auth-tunnel
CLOUDFLARE_TUNNEL_TOKEN=your-token
CLOUDFLARE_TUNNEL_CREDENTIALS_FILE=/path/to/creds.json
```

### auth-service/.env.example (TEMPLATE - Commit This)
```bash
# === Keycloak Management ===
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=your_secure_password_here
KEYCLOAK_PORT=8081

# === Keycloak Database ===
KEYCLOAK_DB=keycloak
KEYCLOAK_POSTGRES_USER=keycloak_user
KEYCLOAK_POSTGRES_PASSWORD=your_db_password_here
KEYCLOAK_POSTGRES_DB=keycloak

# === OAuth2 Secrets ===
KEYCLOAK_API_CLIENT_SECRET=generate_a_long_random_secret_min_32_chars
KEYCLOAK_REALM=society-events

# === Public URL ===
PUBLIC_KEYCLOAK_URL=https://auth.your-domain.com

# === Cloudflare Tunnel ===
CLOUDFLARE_TUNNEL_NAME=your-tunnel-name
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token
CLOUDFLARE_TUNNEL_CREDENTIALS_FILE=/path/to/credentials.json
```

---

### my-society/.env (MINIMAL - Only What It Needs)
```bash
# === Global/Shared (from root .env) ===
COMPOSE_PROJECT_NAME=society
SOCIETY_NAME=GM Global Techies Town
# ... other global vars

# === Keycloak URLs (ONLY these!) ===
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_REALM=society-events

# That's it! No admin credentials, no DB info, no secrets!
# ✅ Everything else comes from other .env files
```

### my-society/.env.example (TEMPLATE - What to Copy)
```bash
# === Keycloak URLs (provided by auth-service) ===
KEYCLOAK_URL=https://auth.your-domain.com
KEYCLOAK_PUBLIC_URL=https://auth.your-domain.com
KEYCLOAK_REALM=society-events

# ℹ️  Note: These point to the auth-service instance
# ℹ️  Do NOT put admin credentials here
# ℹ️  Admin credentials are in ~/auth-service/.env
```

---

## Cleaner Approach: Create KEYCLOAK_ENDPOINT File

### Alternative: Share Single Config Between Repos

```bash
# Create: ~/config/keycloak-endpoints.env (shared by both repos)

PUBLIC_KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_REALM=society-events
KEYCLOAK_ADMIN_CONSOLE_URL=https://auth.gm-global-techies-town.club/admin
```

### auth-service uses full config:
```bash
source ~/config/keycloak-endpoints.env
# Has additional:
KEYCLOAK_ADMIN_USER=...
KEYCLOAK_ADMIN_PASSWORD=...
```

### my-society sources shared config:
```bash
source ~/config/keycloak-endpoints.env
# Only uses PUBLIC_KEYCLOAK_URL
# Doesn't need (and can't access) admin credentials
```

**Advantage**: Single source of truth for public URL ✅

---

## Migration Plan: Clean Up Now

### Step 1: Remove from my-society/.env
```bash
# Delete these from my-society/.env:
❌ KEYCLOAK_ADMIN_USER
❌ KEYCLOAK_ADMIN_PASSWORD
❌ KEYCLOAK_DB
❌ KEYCLOAK_API_CLIENT_SECRET
❌ KEYCLOAK_PORT

# Keep only:
✅ KEYCLOAK_URL
✅ KEYCLOAK_PUBLIC_URL
✅ KEYCLOAK_REALM
```

### Step 2: Verify auth-service Has Complete Config
```bash
# auth-service/.env should have:
✅ KEYCLOAK_ADMIN_USER
✅ KEYCLOAK_ADMIN_PASSWORD
✅ KEYCLOAK_DB
✅ KEYCLOAK_API_CLIENT_SECRET
✅ KEYCLOAK_PORT
✅ KEYCLOAK_REALM
```

### Step 3: Update Documentation
```bash
# Create: docs/ENVIRONMENT_VARIABLES_GUIDE.md

"Keycloak Configuration:
  - All admin/database/secret vars: ~/auth-service/.env
  - Public URLs only: ~/my-society/.env
  
  my-society never needs:
    ❌ KEYCLOAK_ADMIN_USER
    ❌ KEYCLOAK_ADMIN_PASSWORD
    ❌ KEYCLOAK_DB"
```

### Step 4: Developer Onboarding
```bash
# README should say:

"Setup:
1. Clone both repos
2. Setup auth-service:
   cd ~/auth-service
   cp .env.example .env
   podman-compose up -d
   
3. Setup my-society:
   cd ~/my-society
   cp .env.example .env
   docker-compose up -d
   
Note: my-society only needs public Keycloak URL,
not admin credentials. All auth management is in
~/auth-service."
```

---

## Security Benefit: Clear Secrets Boundaries

### Current (Confusing)
```
What's a secret?
  - KEYCLOAK_ADMIN_PASSWORD in my-society → NO (not used here)
  - KEYCLOAK_ADMIN_PASSWORD in auth-service → YES (actual secret)
  
Which do I update?
  - Both? (causes confusion)
  - Just one? (which one?)
```

### Recommended (Clear)
```
Secrets:
  ✅ KEYCLOAK_ADMIN_PASSWORD → auth-service/.env only
  ✅ KEYCLOAK_API_CLIENT_SECRET → auth-service/.env only
  ✅ KEYCLOAK_DB password → auth-service/.env only
  
Public URLs:
  ✅ KEYCLOAK_URL → my-society/.env only
  ✅ KEYCLOAK_PUBLIC_URL → my-society/.env only

Clear ownership! No duplication!
```

---

## Summary: Variables by Ownership

### Keycloak Infrastructure (auth-service manages)
```
auth-service/.env:
  KEYCLOAK_ADMIN_USER ✅
  KEYCLOAK_ADMIN_PASSWORD ✅
  KEYCLOAK_PORT ✅
  KEYCLOAK_DB ✅
  KEYCLOAK_POSTGRES_USER ✅
  KEYCLOAK_POSTGRES_PASSWORD ✅
  KEYCLOAK_API_CLIENT_SECRET ✅
  KEYCLOAK_REALM ✅
  CLOUDFLARE_TUNNEL_* ✅
  PUBLIC_KEYCLOAK_URL (exposes this) ✅
```

### Keycloak Integration (my-society uses)
```
my-society/.env:
  KEYCLOAK_URL ✅ (points to auth-service)
  KEYCLOAK_PUBLIC_URL ✅ (points to auth-service)
  KEYCLOAK_REALM ✅ (references auth-service's realm)
  
  ❌ NOTHING ELSE!
```

### Benefits
- ✅ Clear ownership
- ✅ No duplication
- ✅ Easier to manage
- ✅ Better security
- ✅ Less confusion
- ✅ Scalable to multiple services (car-parking, CCTV)

---

## Your Insight Was 100% Correct! ✅

You identified a real problem:
> "Why are we keeping KEYCLOAK_* variables in my-society repo if auth-service is separate?"

**Answer**: We shouldn't! 

**Action**: Remove all admin/secret Keycloak vars from my-society.

**Keep only**: Public URLs that point to auth-service.

**Result**: Clean separation, clear ownership, better security.
