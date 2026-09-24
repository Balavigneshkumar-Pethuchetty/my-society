# What Variables Give Meaning to "my-society"?

## The Question You're Asking

**What should stay in my-society/.env to represent THIS specific society?**

Not infrastructure, not auth, not shared services... but the actual **SOCIETY CONFIGURATION**.

---

## What Makes "my-society" Unique?

### Variables That DEFINE the Society (Keep These!) ✅

```bash
# === Society Identity (This is what "my-society" MEANS) ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
SOCIETY_ID=11100000-0000-0000-0000-000000000001

# These make it THIS society, not another society
# Change these → completely different organization
# These are in MY-SOCIETY repo because they define what "my-society" IS
```

### Variables That Represent Society Operations (Keep These!) ✅

```bash
# === Society's Financial Configuration ===
SOCIETY_UPI_ID=your@upi
SOCIETY_UPI_NAME=Your Society UPI
SOCIETY_BANK_NAME=Bank Name
SOCIETY_BANK_ACCOUNT=Account Number
SOCIETY_BANK_IFSC=IFSC Code

# These define HOW this society operates financially
# These are in MY-SOCIETY repo because they're society-specific
```

### Variables That Enable Society Services (Keep These!) ✅

```bash
# === What This Society Uses ===
APP_PUBLIC_URL=https://gm-global-techies-town.club
VITE_GOOGLE_LOGIN=true
VITE_PHONE_LOGIN=true

# These define WHAT FEATURES this society offers
# Change these → different society experience
# These are in MY-SOCIETY repo because they're society-specific
```

---

## What Should NOT Be Here (Remove These!) ❌

### Platform/Infrastructure Variables (Not Society-Specific)
```bash
❌ COMPOSE_PROJECT_NAME=society
   (This is docker, not society)

❌ POSTGRES_USER=society_user
   (This is database, not society)

❌ REDIS_PASSWORD=...
   (This is cache, not society)

❌ INTERNAL_API_KEY=...
   (This is inter-service auth, not society)

❌ SPLUNK_HEC_TOKEN=...
   (This is monitoring, not society)

❌ MINIO_ROOT_PASSWORD=...
   (This is storage, not society)
```

### Authentication/Auth Infrastructure (Not Society-Specific)
```bash
❌ KEYCLOAK_URL=...
   (This is infrastructure, belongs in auth-service)

❌ KEYCLOAK_ADMIN_USER=...
   (This is infrastructure)

❌ KEYCLOAK_API_CLIENT_SECRET=...
   (This is infrastructure)

❌ GOOGLE_CLIENT_ID=...
   (This is OAuth provider config, not society config)

❌ OTP_BRIDGE_CLIENT_SECRET=...
   (This is auth infrastructure)

❌ AUTH_SERVICE_API_KEY=...
   (This is inter-service communication, not society)
```

---

## The Cleaner Separation

### my-society/.env (ONLY Society Configuration)
```bash
# ==========================================
# SOCIETY IDENTITY & CONFIGURATION
# ==========================================

# === Who is this society? ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
SOCIETY_ID=11100000-0000-0000-0000-000000000001

# === How does this society operate financially? ===
SOCIETY_UPI_ID=your@upi
SOCIETY_UPI_NAME=GM Global Techies Town
SOCIETY_BANK_NAME=ICICI Bank
SOCIETY_BANK_ACCOUNT=123456789
SOCIETY_BANK_IFSC=ICIC0000001

# === What's the public face of this society? ===
APP_PUBLIC_URL=https://gm-global-techies-town.club

# === What features does this society offer? ===
VITE_GOOGLE_LOGIN=true
VITE_PHONE_LOGIN=true

# That's it! Everything else is infrastructure.
# This .env says: "This is GM Global Techies Town, and here's how it operates"
```

**Result**: The file clearly says "This is my-society" ✅

---

## What Goes Where Instead

### db/.env (Database Configuration)
```bash
POSTGRES_USER=society_user
POSTGRES_PASSWORD=...
POSTGRES_DB=society_events
REDIS_PASSWORD=...
EVENT_DB_USER=...
PAYMENT_DB_USER=...
# etc. (all database-related)
```

### nginx/.env (Nginx Configuration)
```bash
NGINX_PORT=8080
NGINX_ADMIN_USER=...
NGINX_ADMIN_PASSWORD=...
PGADMIN_EMAIL=...
PGADMIN_PASSWORD=...
```

### services/user/.env (User Service Config)
```bash
PII_ENCRYPTION_KEY=...
PII_HASH_KEY=...
MINIO_ROOT_USER=...
NOTIFICATION_SERVICE_URL=...
```

### services/payment/.env (Payment Service Config)
```bash
PAYMENT_SECRET_KEY=...
ANTHROPIC_API_KEY=...
CLAUDE_MODEL=...
```

### auth-service/.env (Auth Infrastructure - SEPARATE REPO)
```bash
KEYCLOAK_ADMIN_USER=...
KEYCLOAK_ADMIN_PASSWORD=...
KEYCLOAK_DB=...
KEYCLOAK_API_CLIENT_SECRET=...
PUBLIC_KEYCLOAK_URL=https://auth.xxx.com
```

### Root .env (Global/Shared Platform)
```bash
COMPOSE_PROJECT_NAME=society
INTERNAL_API_KEY=...
KEYCLOAK_URL=https://auth.xxx.com  (Reference only, defined in auth-service)
GOOGLE_CLIENT_ID=...
SPLUNK_PASSWORD=...
MINIO_ROOT_USER=...
PAYMENT_RECONCILIATION_SECRET_KEY=...
```

---

## Semantic Clarity: What the Files Say

### my-society/.env Says:
```
"I am GM Global Techies Town (GMGT)
Located in Bengaluru
I operate with this UPI: xxx@upi
I bank with: ICICI Bank
My public domain: gm-global-techies-town.club
I offer: Google login, Phone login
ID: 11100000-0000-0000-0000-000000000001"

This file ANSWERS: "What is my-society?"
```

✅ **Semantic clarity**: The file name "my-society" matches its content perfectly!

---

### auth-service/.env Says (Different Repo):
```
"I am the authentication infrastructure
I run Keycloak on port 8081
My database is named 'keycloak'
My admin is 'keycloak_admin'
I expose myself publicly as: https://auth.xxx.com"

This file ANSWERS: "How do we handle authentication?"
```

✅ **Semantic clarity**: The file is about auth infrastructure, not in my-society!

---

### db/.env Says:
```
"I am the database infrastructure
PostgreSQL runs with these credentials
Redis runs with this password
Event service has this DB role
Payment service has this DB role"

This file ANSWERS: "How is the database configured?"
```

✅ **Semantic clarity**: The file is about databases, not in my-society!

---

## Current Messy Situation

```
my-society/.env currently says:
"I am GM Global Techies Town (GMGT)
 Located in Bengaluru
 I operate with this UPI
 I bank with this bank
 I have this Keycloak admin user  ← CONFUSING! (not society-specific)
 I have this Keycloak password    ← CONFUSING! (not society-specific)
 I have this database role        ← CONFUSING! (database, not society)
 I have this Redis password       ← CONFUSING! (infrastructure, not society)
 I have this OAuth secret         ← CONFUSING! (auth, not society)"

Problems:
  ❌ File is cluttered with infrastructure
  ❌ Hard to see what's actually society-specific
  ❌ Misleading name (my-society but contains database stuff)
  ❌ Maintenance nightmare (what if we change database?)
```

---

## Clean Situation (Recommended)

```
my-society/.env says:
"I am GM Global Techies Town (GMGT)
 Located in Bengaluru
 Society ID: 11100000-0000-0000-0000-000000000001
 I operate with this UPI: xxx@upi
 I bank with: ICICI Bank
 My public domain: gm-global-techies-town.club
 I offer: Google login, Phone login"

Clear and focused!
  ✅ Every line is society-specific
  ✅ File clearly answers "What is my-society?"
  ✅ No infrastructure clutter
  ✅ Easy to maintain
  ✅ Semantic clarity: name matches content
```

---

## Practical Example: Two Societies

### If you add a sister society later (GM Bangalore Residents):

```
gm-bangalore/.env
SOCIETY_NAME=GM Bangalore Residents
SOCIETY_SHORT_NAME=GMBR
SOCIETY_CITY=Bengaluru
SOCIETY_ID=22200000-0000-0000-0000-000000000002
SOCIETY_UPI_ID=gmbr@upi
SOCIETY_BANK_NAME=HDFC Bank
SOCIETY_BANK_ACCOUNT=987654321
APP_PUBLIC_URL=https://gm-bangalore.com
VITE_GOOGLE_LOGIN=true
VITE_PHONE_LOGIN=true
```

**Difference**: 
- Both use SAME auth-service
- Both use SAME database infrastructure
- Both use SAME services
- Only SOCIETY configuration differs ✅

This is the power of clean separation!

---

## Final Recommendation: my-society/.env Should Only Have

```bash
# ==========================================
# SOCIETY IDENTITY & CONFIGURATION
# (Everything that makes this "my-society")
# ==========================================

# === Society Identification ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
SOCIETY_ID=11100000-0000-0000-0000-000000000001

# === Financial Configuration ===
SOCIETY_UPI_ID=your@upi
SOCIETY_UPI_NAME=GM Global Techies Town
SOCIETY_BANK_NAME=ICICI Bank
SOCIETY_BANK_ACCOUNT=123456789
SOCIETY_BANK_IFSC=ICIC0000001

# === Public Presence ===
APP_PUBLIC_URL=https://gm-global-techies-town.club

# === Features Offered ===
VITE_GOOGLE_LOGIN=true
VITE_PHONE_LOGIN=true

# That's it! ~12 lines that define THIS society.
# Everything else belongs elsewhere.
```

---

## File Organization That Makes Sense

```
my-society/.env (12 lines)
  └─ What is this society?

nginx/.env (5 lines)
  └─ How does nginx run?

db/.env (20 lines)
  └─ How is the database configured?

frontend/.env (5 lines)
  └─ How is frontend built?

services/user/.env (10 lines)
  └─ How does user-service run?

services/event/.env (10 lines)
  └─ How does event-service run?

services/payment/.env (15 lines)
  └─ How does payment-service run?

services/visitor/.env (10 lines)
  └─ How does visitor-service run?

services/notification/.env (10 lines)
  └─ How does notification-service run?

auth-service/.env (15 lines, SEPARATE REPO)
  └─ How is Keycloak configured?
```

Each file has **ONE CLEAR PURPOSE**.

---

## Checklist: Is Your .env Properly Scoped?

For **my-society/.env**, ask: "Does this variable make sense to change if we deployed for a different society?"

| Variable | Changes for Different Society? | Keep? |
|----------|--------------------------------|-------|
| **SOCIETY_NAME** | ✅ Yes (different name) | ✅ KEEP |
| **SOCIETY_CITY** | ✅ Yes (different city) | ✅ KEEP |
| **SOCIETY_UPI_ID** | ✅ Yes (different UPI) | ✅ KEEP |
| **SOCIETY_BANK_NAME** | ✅ Yes (different bank) | ✅ KEEP |
| **POSTGRES_USER** | ❌ No (same database) | ❌ REMOVE |
| **REDIS_PASSWORD** | ❌ No (same cache) | ❌ REMOVE |
| **KEYCLOAK_URL** | ❌ No (same auth) | ❌ REMOVE |
| **NGINX_ADMIN_USER** | ❌ No (same proxy) | ❌ REMOVE |
| **MINIO_ROOT_USER** | ❌ No (same storage) | ❌ REMOVE |
| **APP_PUBLIC_URL** | ✅ Yes (different domain) | ✅ KEEP |
| **VITE_GOOGLE_LOGIN** | ✅ Yes (society choice) | ✅ KEEP |

---

## Impact of This Change

### Before (Messy)
```
my-society/.env (50+ lines)
- Infrastructure clutter
- Hard to understand what "my-society" means
- Difficult to deploy for a different society
- Maintenance nightmare
```

### After (Clean)
```
my-society/.env (12 lines)
- Only society-specific configuration
- Clear: "This repo defines THIS society"
- Easy to deploy for a different society
- Maintainable and understandable
```

---

## Summary: What Stays in my-society/.env

✅ **KEEP** (Society-Specific):
```bash
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
SOCIETY_ID
SOCIETY_UPI_ID
SOCIETY_UPI_NAME
SOCIETY_BANK_NAME
SOCIETY_BANK_ACCOUNT
SOCIETY_BANK_IFSC
APP_PUBLIC_URL
VITE_GOOGLE_LOGIN
VITE_PHONE_LOGIN
```

❌ **REMOVE** (Infrastructure):
```bash
COMPOSE_PROJECT_NAME       → Use in docker-compose.yml directly
POSTGRES_USER              → Move to db/.env
POSTGRES_PASSWORD          → Move to db/.env
REDIS_PASSWORD             → Move to db/.env
KEYCLOAK_*                 → Move to auth-service/.env
GOOGLE_CLIENT_SECRET       → Move to root .env or services/*/.env
MINIO_ROOT_USER            → Move to services/*/.env
INTERNAL_API_KEY           → Move to root .env
SPLUNK_*                   → Move to root .env
```

---

## The Naming Alignment

**Repository Name**: my-society  
**Purpose**: Define and configure THIS specific society  
**What it contains**: Society identity, society operations, society features  

This creates **semantic alignment**: the repo name matches its content! ✅

---

## Action: Clean Up my-society/.env

Keep only these sections:

```bash
# === Society Identity ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
SOCIETY_ID=11100000-0000-0000-0000-000000000001

# === Financial Configuration ===
SOCIETY_UPI_ID=...
SOCIETY_UPI_NAME=...
SOCIETY_BANK_NAME=...
SOCIETY_BANK_ACCOUNT=...
SOCIETY_BANK_IFSC=...

# === Public Presence ===
APP_PUBLIC_URL=https://gm-global-techies-town.club

# === Features ===
VITE_GOOGLE_LOGIN=true
VITE_PHONE_LOGIN=true
```

**Everything else belongs in specialized .env files** ✅
