# Environment Variables: Migration & Service Restart Guide

## Phase 1: What to Keep Where (Final State)

### Step 1: Clean my-society/.env (Society-Specific Only)

**File**: `.env`

```bash
# ==========================================
# MY-SOCIETY: SOCIETY-SPECIFIC CONFIGURATION ONLY
# ==========================================

# === Project Metadata ===
COMPOSE_PROJECT_NAME=society

# === Society Identity ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru

# === Financial Configuration ===
SOCIETY_UPI_ID=your@upi
SOCIETY_UPI_NAME=GM Global Techies Town
SOCIETY_BANK_NAME=ICICI Bank
SOCIETY_BANK_ACCOUNT=123456789
SOCIETY_BANK_IFSC=ICIC0000001

# === Public URLs ===
APP_PUBLIC_URL=https://gm-global-techies-town.club
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club

# === Features ===
VITE_GOOGLE_LOGIN=true
VITE_PHONE_LOGIN=true
```

**That's it! Everything else moves to specialized .env files.** ✅

---

### Step 2: db/.env (Database Configuration)

**File**: `db/.env`

```bash
# ==========================================
# DATABASE CONFIGURATION
# ==========================================

# === PostgreSQL Main Database ===
POSTGRES_USER=society_user
POSTGRES_PASSWORD=S0c!etyP@ss2025
POSTGRES_PORT=5432
POSTGRES_DB=society_events

# === Database Roles per Service (Schema Isolation) ===
EVENT_DB_USER=event_role
EVENT_DB_PASSWORD=8jEcD86LsJbSM3iyJQyG7oi1

TICKET_DB_USER=ticket_role
TICKET_DB_PASSWORD=oAkqn10c6nczoZ9gUSV60wuB

USER_DB_USER=user_role
USER_DB_PASSWORD=St1D8RRBr9PO6CdO5SD4CIqk

PAYMENT_DB_USER=payment_role
PAYMENT_DB_PASSWORD=I2ySbGBaCFmeWOBvxHlgN4DM

REGISTRATION_DB_USER=registration_role
REGISTRATION_DB_PASSWORD=5P9CcvMYM1tkZddSiwAveKgR

# === Visitor Service (Dedicated PostgreSQL) ===
VISITOR_POSTGRES_USER=visitor_service
VISITOR_POSTGRES_PASSWORD=V!sitorP@ss2025
VISITOR_POSTGRES_DB=visitor_service

# === Redis Cache ===
REDIS_PASSWORD=R3d!sP@ss2025
REDIS_PORT=6379
```

---

### Step 3: nginx/.env (Nginx Configuration)

**File**: `nginx/.env`

```bash
# ==========================================
# NGINX CONFIGURATION
# ==========================================

NGINX_PORT=8080
NGINX_ADMIN_USER=admin
NGINX_ADMIN_PASSWORD=Adm!nN@x2025

PGADMIN_EMAIL=dev@society.com
PGADMIN_PASSWORD=PgAdmin@2025
PGADMIN_PORT=5050
```

---

### Step 4: frontend/.env (Frontend Build)

**File**: `frontend/.env`

```bash
# ==========================================
# FRONTEND CONFIGURATION
# ==========================================

VITE_MODE=production
VITE_APP_ENV=prod
VITE_GOOGLE_LOGIN=true
VITE_PHONE_LOGIN=true
```

---

### Step 5: services/user/.env (User Service)

**File**: `services/user/.env`

```bash
# ==========================================
# USER SERVICE CONFIGURATION
# ==========================================

COMPOSE_PROJECT_NAME=society

# === Database ===
USER_DB_USER=user_role
USER_DB_PASSWORD=St1D8RRBr9PO6CdO5SD4CIqk
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events

# === PII Encryption ===
PII_ENCRYPTION_KEY=t8D5jch6oq/EpPfo3H3Vv13x8lN3nqwrBqQxs87K/iM=
PII_HASH_KEY=nYYkHaUQ4yRc5CLDhcWl_6fr-sx1VMZIyt64edKOD7VsP-bVaVAy4c0Rer-9OuHd

# === Keycloak ===
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club

# === Inter-Service Communication ===
INTERNAL_API_KEY=Int3rn@lSvc2025
NOTIFICATION_SERVICE_URL=http://notification-service:3009

# === Auth Service ===
AUTH_SERVICE_API_KEY=eDv-RXEnQm1lrUwQe77ligJm3QwPuQ7lbCrreOyZejU
OTP_BRIDGE_CLIENT_ID=otp-bridge
OTP_BRIDGE_CLIENT_SECRET=ff94c04132a2ffd8faa9938436f42a8ac9d05263ed97607b6446762de7fb4f03

# === MinIO ===
MINIO_ROOT_USER=minio_admin
MINIO_ROOT_PASSWORD=55JQFLjBWuLDMpI_VCDmhg66X_O_d2kR

# === Society Config ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
APP_PUBLIC_URL=https://gm-global-techies-town.club

# === Email ===
GMAIL_SMTP_USER=gm.gtt.club@gmail.com
GMAIL_APP_PASSWORD=<your-gmail-app-password>

# === Monitoring ===
SPLUNK_HEC_TOKEN=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### Step 6: services/event/.env (Event Service)

**File**: `services/event/.env`

```bash
# ==========================================
# EVENT SERVICE CONFIGURATION
# ==========================================

COMPOSE_PROJECT_NAME=society

# === Database ===
EVENT_DB_USER=event_role
EVENT_DB_PASSWORD=8jEcD86LsJbSM3iyJQyG7oi1
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events

# === Cache ===
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=R3d!sP@ss2025

# === Keycloak ===
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club

# === Inter-Service ===
INTERNAL_API_KEY=Int3rn@lSvc2025
NOTIFICATION_SERVICE_URL=http://notification-service:3009

# === Auth Service ===
AUTH_SERVICE_API_KEY=eDv-RXEnQm1lrUwQe77ligJm3QwPuQ7lbCrreOyZejU

# === Society Config ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
APP_PUBLIC_URL=https://gm-global-techies-town.club

# === UPI/Banking ===
SOCIETY_UPI_ID=your@upi
SOCIETY_UPI_NAME=GM Global Techies Town
SOCIETY_BANK_NAME=ICICI Bank
SOCIETY_BANK_ACCOUNT=123456789
SOCIETY_BANK_IFSC=ICIC0000001

# === Email ===
GMAIL_SMTP_USER=gm.gtt.club@gmail.com
GMAIL_APP_PASSWORD=<your-gmail-app-password>

# === Monitoring ===
SPLUNK_HEC_TOKEN=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### Step 7: services/ticket/.env (Ticket Service)

**File**: `services/ticket/.env`

```bash
# ==========================================
# TICKET SERVICE CONFIGURATION
# ==========================================

COMPOSE_PROJECT_NAME=society

# === Database ===
TICKET_DB_USER=ticket_role
TICKET_DB_PASSWORD=oAkqn10c6nczoZ9gUSV60wuB
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events

# === Keycloak ===
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club

# === Inter-Service ===
INTERNAL_API_KEY=Int3rn@lSvc2025
NOTIFICATION_SERVICE_URL=http://notification-service:3009

# === Society Config ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru

# === Monitoring ===
SPLUNK_HEC_TOKEN=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### Step 8: services/registration/.env (Registration Service)

**File**: `services/registration/.env`

```bash
# ==========================================
# REGISTRATION SERVICE CONFIGURATION
# ==========================================

COMPOSE_PROJECT_NAME=society

# === Database ===
REGISTRATION_DB_USER=registration_role
REGISTRATION_DB_PASSWORD=5P9CcvMYM1tkZddSiwAveKgR
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events

# === Keycloak ===
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club

# === Inter-Service ===
INTERNAL_API_KEY=Int3rn@lSvc2025
NOTIFICATION_SERVICE_URL=http://notification-service:3009

# === Auth Service ===
AUTH_SERVICE_API_KEY=eDv-RXEnQm1lrUwQe77ligJm3QwPuQ7lbCrreOyZejU

# === Society Config ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
APP_PUBLIC_URL=https://gm-global-techies-town.club

# === UPI/Banking ===
SOCIETY_UPI_ID=your@upi
SOCIETY_UPI_NAME=GM Global Techies Town
SOCIETY_BANK_NAME=ICICI Bank
SOCIETY_BANK_ACCOUNT=123456789
SOCIETY_BANK_IFSC=ICIC0000001

# === Email ===
GMAIL_SMTP_USER=gm.gtt.club@gmail.com
GMAIL_APP_PASSWORD=<your-gmail-app-password>

# === MinIO ===
MINIO_ROOT_USER=minio_admin
MINIO_ROOT_PASSWORD=55JQFLjBWuLDMpI_VCDmhg66X_O_d2kR

# === Monitoring ===
SPLUNK_HEC_TOKEN=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### Step 9: services/payment/.env (Payment Service)

**File**: `services/payment/.env`

```bash
# ==========================================
# PAYMENT SERVICE CONFIGURATION
# ==========================================

COMPOSE_PROJECT_NAME=society

# === Database ===
PAYMENT_DB_USER=payment_role
PAYMENT_DB_PASSWORD=I2ySbGBaCFmeWOBvxHlgN4DM
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events

# === Keycloak ===
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club

# === Inter-Service ===
INTERNAL_API_KEY=Int3rn@lSvc2025
NOTIFICATION_SERVICE_URL=http://notification-service:3009

# === Payment Encryption ===
PAYMENT_SECRET_KEY=43Pea4IX6FyG5pdUNomoNMaoqEsPR4aoDe-FZ39Lr5M=

# === Payment Reconciliation ===
PAYMENT_RECONCILIATION_SECRET_KEY=change-this-to-a-long-random-secret-key

# === Environment ===
PAYMENT_SERVICE_ENV=testing

# === AI Provider ===
CLAUDE_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=<your-anthropic-api-key>

# === Auth Service ===
AUTH_SERVICE_API_KEY=<your-auth-service-api-key>

# === Society Config ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
APP_PUBLIC_URL=https://gm-global-techies-town.club

# === Email ===
GMAIL_SMTP_USER=gm.gtt.club@gmail.com
GMAIL_APP_PASSWORD=<your-gmail-app-password>

# === MinIO ===
MINIO_ROOT_USER=minio_admin
MINIO_ROOT_PASSWORD=55JQFLjBWuLDMpI_VCDmhg66X_O_d2kR

# === Monitoring ===
SPLUNK_HEC_TOKEN=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### Step 10: services/visitor/.env (Visitor Service)

**File**: `services/visitor/.env`

```bash
# ==========================================
# VISITOR SERVICE CONFIGURATION
# ==========================================

COMPOSE_PROJECT_NAME=society

# === Visitor Database (Dedicated) ===
VISITOR_POSTGRES_HOST=visitor_postgres
VISITOR_POSTGRES_PORT=5432
VISITOR_POSTGRES_USER=visitor_service
VISITOR_POSTGRES_PASSWORD=V!sitorP@ss2025
VISITOR_POSTGRES_DB=visitor_service

# === Keycloak ===
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club

# === Inter-Service ===
INTERNAL_API_KEY=Int3rn@lSvc2025
NOTIFICATION_SERVICE_URL=http://notification-service:3009

# === Auth Service ===
AUTH_SERVICE_API_KEY=eDv-RXEnQm1lrUwQe77ligJm3QwPuQ7lbCrreOyZejU

# === Society Config ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru

# === MinIO ===
MINIO_ROOT_USER=minio_admin
MINIO_ROOT_PASSWORD=55JQFLjBWuLDMpI_VCDmhg66X_O_d2kR

# === Monitoring ===
SPLUNK_HEC_TOKEN=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

### Step 11: services/notification/.env (Notification Service)

**File**: `services/notification/.env`

```bash
# ==========================================
# NOTIFICATION SERVICE CONFIGURATION
# ==========================================

COMPOSE_PROJECT_NAME=society

# === Environment ===
ENVIRONMENT=development
DEBUG=false
SERVICE_PORT=3009

# === Database (pgBouncer) ===
DB_HOST=pgbouncer
DB_PORT=6432
DB_NAME=society_events
DB_USER=postgres
DB_PASSWORD=S0c!etyP@ss2025
DB_POOL_SIZE=5

# === Novu ===
NOVU_API_KEY=
NOVU_BACKEND_URL=https://api.novu.co
NOVU_STRATEGY=NOVU_WITH_FALLBACK

# === Fallback Channels ===
AUTH_SERVICE_URL=http://host.containers.internal:8000
AUTH_SERVICE_API_KEY=eDv-RXEnQm1lrUwQe77ligJm3QwPuQ7lbCrreOyZejU

# === Email ===
GMAIL_SMTP_USER=gm.gtt.club@gmail.com
GMAIL_APP_PASSWORD=<your-gmail-app-password>

# === Keycloak ===
KEYCLOAK_URL=https://auth.gm-global-techies-town.club
KEYCLOAK_REALM=society-events
KEYCLOAK_PUBLIC_URL=https://auth.gm-global-techies-town.club

# === Inter-Service ===
INTERNAL_API_KEY=Int3rn@lSvc2025
USER_SERVICE_URL=http://user-service:3001

# === Society Config ===
SOCIETY_NAME=GM Global Techies Town
SOCIETY_SHORT_NAME=GMGT
SOCIETY_CITY=Bengaluru
SOCIETY_ID=11100000-0000-0000-0000-000000000001

# === Async ===
USE_BACKGROUND_TASKS=true

# === Monitoring ===
SPLUNK_HEC_URL=http://host.containers.internal:8088/services/collector/event
SPLUNK_HEC_TOKEN=a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## Phase 2: Step-by-Step Migration

### Migration Checklist

- [ ] Step 1: Read this entire guide
- [ ] Step 2: Backup current .env files
- [ ] Step 3: Create/update all .env files listed above
- [ ] Step 4: Verify all .env files exist
- [ ] Step 5: Stop all services
- [ ] Step 6: Restart services using commands below

---

## Phase 3: How to Restart Services

### Option A: Restart Everything (Easiest)

```bash
# From repo root (~/my-society/)

# 1. Stop all services
docker-compose down

# 2. Remove volumes (if you want fresh start)
# docker-compose down -v

# 3. Restart all services
docker-compose up -d

# 4. Check status
docker-compose ps

# 5. View logs
docker-compose logs -f
```

---

### Option B: Restart Specific Services (Selective)

```bash
# From repo root

# Restart user-service only
docker-compose restart user-service

# Restart event-service only
docker-compose restart event-service

# Restart multiple services
docker-compose restart payment-service registration-service

# Restart without stopping (pull latest image)
docker-compose up -d --build user-service
```

---

### Option C: Restart Individual Service in Its Folder (Advanced)

```bash
# Restart event-service from its own directory
cd ~/my-society/services/event
docker-compose --env-file .env --env-file ../../db/.env restart

# Restart payment-service
cd ~/my-society/services/payment
docker-compose --env-file .env --env-file ../../db/.env restart
```

---

### Option D: Using Make Targets (If Available)

```bash
# Create these targets in Makefile

# Restart all services
make restart

# Restart specific service
make restart-user
make restart-event
make restart-payment

# Example Makefile content:
# .PHONY: restart restart-user restart-event
# restart:
# 	docker-compose down
# 	docker-compose up -d
# 
# restart-user:
# 	docker-compose restart user-service
# 
# restart-event:
# 	docker-compose restart event-service
```

---

## Phase 4: Verification After Restart

### Check All Services Are Running

```bash
# From repo root

# Check service status
docker-compose ps

# You should see:
# STATUS: Up (or Up X seconds)
# All services should show "Up"
```

### Check Logs for Errors

```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f user-service
docker-compose logs -f event-service

# Look for:
❌ Connection refused
❌ environment variable missing
❌ Authentication failed

# Good signs:
✅ Service started successfully
✅ Listening on port XXXX
✅ Connected to database
```

### Test Individual Services

```bash
# Check if user-service is responding
curl http://localhost:3001/health

# Check if event-service is responding
curl http://localhost:3002/health

# Check if nginx is responding
curl http://localhost:8080/health

# Expected response:
# {"status":"ok"}
```

---

## Phase 5: Common Issues & Fixes

### Issue 1: "environment variable not found"

**Cause**: .env file missing or not loaded

**Solution**:
```bash
# Verify .env files exist
ls -la .env
ls -la db/.env
ls -la nginx/.env
ls -la services/user/.env

# Restart service
docker-compose restart <service-name>
```

---

### Issue 2: "Cannot connect to database"

**Cause**: Database credentials mismatch

**Solution**:
```bash
# Verify database is running
docker-compose logs postgres

# Check database password in db/.env matches what services use
grep POSTGRES_PASSWORD db/.env
grep POSTGRES_PASSWORD services/user/.env

# Restart services
docker-compose restart
```

---

### Issue 3: "Port already in use"

**Cause**: Service already running on that port

**Solution**:
```bash
# Kill process on port (example: 3002 for event-service)
lsof -i :3002
kill -9 <PID>

# OR stop all containers
docker-compose down

# OR use different port
# Edit docker-compose.yml and change port mapping
```

---

### Issue 4: "Service won't start"

**Cause**: Multiple possible causes

**Solution**:
```bash
# View detailed logs
docker-compose logs <service-name>

# Check for syntax errors in .env files
cat services/user/.env | grep -E "^[A-Z_]+=.+" | head -5

# Rebuild image
docker-compose build <service-name>

# Restart with fresh build
docker-compose up -d --build <service-name>
```

---

## Quick Reference: Commands You'll Use

```bash
# Daily operations
docker-compose ps              # Check service status
docker-compose logs -f         # Watch logs
docker-compose restart         # Restart all

# Specific service operations
docker-compose restart event-service
docker-compose logs event-service
docker-compose up -d event-service

# Full lifecycle
docker-compose down            # Stop everything
docker-compose up -d           # Start everything
docker-compose restart         # Restart everything

# Debugging
docker-compose logs -f service-name
curl http://localhost:3001/health
```

---

## Final Checklist: Before Going Live

- [ ] All .env files created with correct variables
- [ ] No duplicate variables between files
- [ ] All services restarted successfully
- [ ] All services showing "Up" in `docker-compose ps`
- [ ] No errors in logs (`docker-compose logs`)
- [ ] Health endpoints responding (`curl http://localhost:3001/health`)
- [ ] Able to login (test Keycloak integration)
- [ ] Able to create events (test event-service)
- [ ] Able to register (test registration-service)

---

## Summary: What You've Done

✅ Cleaned up my-society/.env (society-specific only)  
✅ Created db/.env (database configuration)  
✅ Created nginx/.env (reverse proxy config)  
✅ Created frontend/.env (build config)  
✅ Updated all services/*/env files  
✅ Removed duplication and confusion  
✅ Ready to restart services  

**Result**: Clean, organized, maintainable configuration! 🎉
