# Migration Guide: Monolithic .env → Segregated .env Files

This guide explains how to migrate from a single `.env` file to the new segregated environment variable structure.

## Why Segregate Environment Variables?

- **Clarity**: Each service/component has a clear list of variables it needs
- **Security**: Easier to audit which secrets belong where
- **Scalability**: Easier to deploy individual services with the right config
- **Maintainability**: Changes to one service's config don't affect others

## New Directory Structure

```
my-society/
├── .env                           # Global/shared variables
├── nginx/.env                     # Nginx only
├── db/.env                        # Database & Redis
├── frontend/.env                  # Frontend build vars
└── services/
    ├── user/.env
    ├── event/.env
    ├── ticket/.env
    ├── registration/.env
    ├── payment/.env
    ├── visitor/.env
    └── notification/.env
```

## Step-by-Step Migration

### 1. Prepare the New Structure

Each folder now has:
- `.env` — actual values (gitignored)
- `.env.example` — template with placeholders (committed)

### 2. Extract Values from Your Current .env

You already have a working `.env` file. We'll use it as the source for the new structure.

### 3. Copy Values to Component Files

Use the mapping below to distribute your current `.env` values:

#### Root `.env` ← From original .env:
```bash
# Global/Shared variables
COMPOSE_PROJECT_NAME
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
APP_PUBLIC_URL
KEYCLOAK_URL
KEYCLOAK_PUBLIC_URL
KEYCLOAK_ADMIN_USER
KEYCLOAK_ADMIN_PASSWORD
KEYCLOAK_DB
KEYCLOAK_API_CLIENT_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
OTP_BRIDGE_CLIENT_ID
OTP_BRIDGE_CLIENT_SECRET
AUTH_SERVICE_API_KEY
INTERNAL_API_KEY
MINIO_ROOT_USER
MINIO_ROOT_PASSWORD
MINIO_CONSOLE_PORT
SPLUNK_PASSWORD
SPLUNK_HEC_TOKEN
SPLUNK_PORT
PAYMENT_RECONCILIATION_SECRET_KEY
```

#### `nginx/.env` ← From original .env:
```bash
NGINX_PORT
NGINX_ADMIN_USER
NGINX_ADMIN_PASSWORD
PGADMIN_EMAIL
PGADMIN_PASSWORD
PGADMIN_PORT
```

#### `db/.env` ← From original .env:
```bash
POSTGRES_USER
POSTGRES_PASSWORD
POSTGRES_PORT
POSTGRES_DB
EVENT_DB_USER
EVENT_DB_PASSWORD
TICKET_DB_USER
TICKET_DB_PASSWORD
USER_DB_USER
USER_DB_PASSWORD
PAYMENT_DB_USER
PAYMENT_DB_PASSWORD
REGISTRATION_DB_USER
REGISTRATION_DB_PASSWORD
VISITOR_POSTGRES_USER
VISITOR_POSTGRES_PASSWORD
VISITOR_POSTGRES_DB
REDIS_PASSWORD
REDIS_PORT
```

#### `frontend/.env` ← From original .env:
```bash
VITE_MODE
VITE_APP_ENV
VITE_GOOGLE_LOGIN
VITE_PHONE_LOGIN
```

#### `services/user/.env` ← From original .env:
```bash
COMPOSE_PROJECT_NAME=society
USER_DB_USER
USER_DB_PASSWORD
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events
PII_ENCRYPTION_KEY
PII_HASH_KEY
KEYCLOAK_URL
KEYCLOAK_PUBLIC_URL
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL=http://notification-service:3009
AUTH_SERVICE_API_KEY
OTP_BRIDGE_CLIENT_ID
OTP_BRIDGE_CLIENT_SECRET
MINIO_ROOT_USER
MINIO_ROOT_PASSWORD
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
APP_PUBLIC_URL
GMAIL_SMTP_USER
GMAIL_APP_PASSWORD
SPLUNK_HEC_TOKEN
```

#### `services/event/.env` ← From original .env:
```bash
COMPOSE_PROJECT_NAME=society
EVENT_DB_USER
EVENT_DB_PASSWORD
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events
REDIS_HOST=redis
REDIS_PORT
REDIS_PASSWORD
KEYCLOAK_URL
KEYCLOAK_PUBLIC_URL
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL=http://notification-service:3009
AUTH_SERVICE_API_KEY
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
APP_PUBLIC_URL
SOCIETY_UPI_ID
SOCIETY_UPI_NAME
SOCIETY_BANK_NAME
SOCIETY_BANK_ACCOUNT
SOCIETY_BANK_IFSC
SOCIETY_BANK_BENEFICIARY
GMAIL_SMTP_USER
GMAIL_APP_PASSWORD
SPLUNK_HEC_TOKEN
```

#### `services/ticket/.env` ← From original .env:
```bash
COMPOSE_PROJECT_NAME=society
TICKET_DB_USER
TICKET_DB_PASSWORD
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events
KEYCLOAK_URL
KEYCLOAK_PUBLIC_URL
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL=http://notification-service:3009
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
SPLUNK_HEC_TOKEN
```

#### `services/registration/.env` ← From original .env:
```bash
COMPOSE_PROJECT_NAME=society
REGISTRATION_DB_USER
REGISTRATION_DB_PASSWORD
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events
KEYCLOAK_URL
KEYCLOAK_PUBLIC_URL
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL=http://notification-service:3009
AUTH_SERVICE_API_KEY
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
APP_PUBLIC_URL
SOCIETY_UPI_ID
SOCIETY_UPI_NAME
SOCIETY_BANK_NAME
SOCIETY_BANK_ACCOUNT
SOCIETY_BANK_IFSC
SOCIETY_BANK_BENEFICIARY
GMAIL_SMTP_USER
GMAIL_APP_PASSWORD
MINIO_ROOT_USER
MINIO_ROOT_PASSWORD
SPLUNK_HEC_TOKEN
```

#### `services/payment/.env` ← From original .env:
```bash
COMPOSE_PROJECT_NAME=society
PAYMENT_DB_USER
PAYMENT_DB_PASSWORD
POSTGRES_HOST=society_postgres
POSTGRES_PORT=5432
POSTGRES_DB=society_events
KEYCLOAK_URL
KEYCLOAK_PUBLIC_URL
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL=http://notification-service:3009
PAYMENT_SECRET_KEY
PAYMENT_RECONCILIATION_SECRET_KEY
PAYMENT_SERVICE_ENV
CLAUDE_MODEL
ANTHROPIC_API_KEY
AUTH_SERVICE_API_KEY
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
APP_PUBLIC_URL
GMAIL_SMTP_USER
GMAIL_APP_PASSWORD
MINIO_ROOT_USER
MINIO_ROOT_PASSWORD
SPLUNK_HEC_TOKEN
```

#### `services/visitor/.env` ← From original .env:
```bash
COMPOSE_PROJECT_NAME=society
VISITOR_POSTGRES_HOST=visitor_postgres
VISITOR_POSTGRES_PORT=5432
VISITOR_POSTGRES_USER
VISITOR_POSTGRES_PASSWORD
VISITOR_POSTGRES_DB
KEYCLOAK_URL
KEYCLOAK_PUBLIC_URL
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL=http://notification-service:3009
AUTH_SERVICE_API_KEY
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
MINIO_ROOT_USER
MINIO_ROOT_PASSWORD
SPLUNK_HEC_TOKEN
```

#### `services/notification/.env` ← From original .env + new vars:
```bash
COMPOSE_PROJECT_NAME=society (if using docker compose per-service)
ENVIRONMENT=development
DEBUG=false
SERVICE_PORT=3009
DB_HOST=pgbouncer
DB_PORT=6432
DB_NAME=society_events
DB_USER=postgres  (from POSTGRES_USER)
DB_PASSWORD=      (from POSTGRES_PASSWORD)
DB_POOL_SIZE=5
NOVU_API_KEY=     (new - get from Novu)
NOVU_BACKEND_URL=https://api.novu.co
NOVU_STRATEGY=NOVU_WITH_FALLBACK
AUTH_SERVICE_URL=http://host.containers.internal:8000
AUTH_SERVICE_API_KEY
GMAIL_SMTP_USER
GMAIL_APP_PASSWORD
KEYCLOAK_URL
KEYCLOAK_REALM=society-events
KEYCLOAK_PUBLIC_URL
INTERNAL_API_KEY
USER_SERVICE_URL=http://user-service:3001
SOCIETY_NAME
SOCIETY_SHORT_NAME
SOCIETY_CITY
SOCIETY_ID=11100000-0000-0000-0000-000000000001
USE_BACKGROUND_TASKS=true
SPLUNK_HEC_URL=http://host.containers.internal:8088/services/collector/event
SPLUNK_HEC_TOKEN
```

### 4. Update Docker Compose Usage

**Old approach** (single .env):
```bash
docker compose up -d
```

**New approach** (multiple .env files):
```bash
# The root docker-compose.yml loads from .env + service .env files
docker compose up -d

# Or for a single service:
docker compose --env-file .env --env-file db/.env --env-file services/payment/.env up -d payment-service
```

The root `docker-compose.yml` and `Makefile` should be updated to reference the right files.

### 5. Update .gitignore

Ensure all `.env` files (not `.env.example`) are in `.gitignore`:

```bash
# Environment variables (real values)
.env
nginx/.env
db/.env
frontend/.env
services/*/.env

# But DO commit these templates:
!.env.example
!nginx/.env.example
!db/.env.example
!frontend/.env.example
!services/*/.env.example
```

## Verification Checklist

After migration:

- [ ] All service `.env` files exist and have correct values
- [ ] All `.env.example` templates are committed (no secrets)
- [ ] `.gitignore` properly excludes `.env` but includes `.env.example`
- [ ] Root `docker-compose.yml` and `Makefile` reference the right files
- [ ] `make up` successfully starts all services
- [ ] `make logs` shows no "missing env var" errors
- [ ] Individual `docker compose --env-file` commands work for single services

## Rollback (If Needed)

If you need to go back to the monolithic structure:

```bash
# Merge all .env files into one:
cat .env nginx/.env db/.env frontend/.env services/*/.env > .env.monolithic

# Commit and distribute:
cp .env.monolithic .env
git add .env
git commit -m "rollback: merge segregated env files back to monolithic .env"
```

## Benefits Going Forward

With segregated .env files:

1. **Deploy a single service** without exporting all variables:
   ```bash
   docker compose --env-file db/.env --env-file services/payment/.env up -d payment-service
   ```

2. **Audit what a service needs** by looking at its `.env.example`

3. **Rotate secrets safely** without restarting the whole stack:
   ```bash
   # Update db/.env with new password, run:
   docker compose --env-file db/.env --env-file services/payment/.env up -d payment-service
   ```

4. **Scale to multiple environments** easily:
   ```bash
   # Use environment-specific files:
   docker compose --env-file .env.prod --env-file db/.env.prod up -d
   ```

## Questions?

See `ENV_STRUCTURE.md` for detailed documentation of each component's variables.
