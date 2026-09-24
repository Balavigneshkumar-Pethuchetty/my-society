# Environment Variable Segregation — Complete Reference

This document explains the new segregated environment variable structure implemented as of commit `ed798c9`.

## Overview

Environment variables are now organized by component ownership:

```
.env                      → Society identity & public URLs (my-society specific)
db/.env                   → Database credentials & Redis configuration
nginx/.env                → Nginx & pgAdmin settings
frontend/.env             → Frontend build variables
services/*/. env          → Service-specific configuration
```

## File Organization

### Root: `.env` (Society-specific)
Contains **only** variables that define this specific society installation:

```
COMPOSE_PROJECT_NAME        # Docker Compose project identifier
SOCIETY_NAME                # Society's full name
SOCIETY_SHORT_NAME          # Abbreviation
SOCIETY_CITY                # City location
SOCIETY_UPI_ID              # Payment configuration (empty if not configured)
SOCIETY_BANK_*              # Banking details (optional)
APP_PUBLIC_URL              # Public domain
KEYCLOAK_URL                # Auth service URL
KEYCLOAK_PUBLIC_URL         # Public auth URL
VITE_GOOGLE_LOGIN           # Frontend feature flag
VITE_PHONE_LOGIN            # Frontend feature flag
```

**Purpose**: Represents the "identity" of this specific installation. Values change when deploying to a different society or environment.

### Infrastructure: `db/.env` (Database & Redis)
All database and cache infrastructure:

```
# PostgreSQL (main shared database)
POSTGRES_USER               # Main admin user
POSTGRES_PASSWORD           # Admin password
POSTGRES_PORT               # Host port (5432)
POSTGRES_DB                 # Database name

# Service-specific DB roles (schema isolation)
EVENT_DB_USER/PASSWORD
TICKET_DB_USER/PASSWORD
USER_DB_USER/PASSWORD
PAYMENT_DB_USER/PASSWORD
REGISTRATION_DB_USER/PASSWORD
NOTIFICATION_DB_USER/PASSWORD

# Visitor Service (dedicated Postgres)
VISITOR_POSTGRES_USER
VISITOR_POSTGRES_PASSWORD
VISITOR_POSTGRES_DB

# Redis Cache
REDIS_PASSWORD
REDIS_PORT
```

**Purpose**: Centralized database credentials. Database team manages this file.

### Infrastructure: `nginx/.env` (Web Server & Admin UI)
Nginx and pgAdmin settings:

```
NGINX_PORT                  # Host port (8080 default)
NGINX_ADMIN_USER            # Basic auth username
NGINX_ADMIN_PASSWORD        # Basic auth password
PGADMIN_EMAIL               # pgAdmin login email
PGADMIN_PASSWORD            # pgAdmin login password
PGADMIN_PORT                # Host port (5050 default)
```

**Purpose**: Web tier configuration. DevOps/Infrastructure team manages this.

### Infrastructure: `frontend/.env` (Frontend Build)
Vite build variables:

```
VITE_MODE                   # build mode (production/development)
VITE_APP_ENV                # app environment
VITE_GOOGLE_LOGIN           # Feature flag
VITE_PHONE_LOGIN            # Feature flag
VITE_KEYCLOAK_URL           # Auth endpoint for frontend
VITE_APP_PUBLIC_URL         # Public URL for frontend
```

**Purpose**: Frontend-specific build and runtime settings. Frontend team manages this.

### Services: `services/*/. env` (Service Configuration)
Each backend service has its own configuration:

#### `services/user/.env`
```
USER_DB_USER/PASSWORD       # Database credentials
PII_ENCRYPTION_KEY          # Encryption for sensitive data
PII_HASH_KEY                # Hashing key for PII
KEYCLOAK_*                  # Auth service connection
KEYCLOAK_ADMIN_*            # Admin credentials for Keycloak management
INTERNAL_API_KEY            # Inter-service communication
NOTIFICATION_SERVICE_URL    # Notification service endpoint
AUTH_SERVICE_API_KEY        # Auth service API key
OTP_BRIDGE_CLIENT_*         # OTP integration
MINIO_*                     # Object storage credentials
SOCIETY_*                   # Society identification
GMAIL_*                     # Email credentials
SPLUNK_HEC_TOKEN            # Monitoring
```

#### `services/event/.env`
```
EVENT_DB_USER/PASSWORD      # Database credentials
REDIS_*                     # Cache connection
KEYCLOAK_*                  # Auth validation
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL
AUTH_SERVICE_API_KEY
SOCIETY_*
SOCIETY_UPI_*               # Payment configuration
GMAIL_*
MINIO_*
SPLUNK_HEC_TOKEN
```

#### `services/ticket/.env`
```
TICKET_DB_USER/PASSWORD
KEYCLOAK_*
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL
SOCIETY_*
MINIO_*
SPLUNK_HEC_TOKEN
```

#### `services/registration/.env`
```
REGISTRATION_DB_USER/PASSWORD
KEYCLOAK_*
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL
AUTH_SERVICE_API_KEY
SOCIETY_*
SOCIETY_UPI_*
GMAIL_*
MINIO_*
SPLUNK_HEC_TOKEN
```

#### `services/payment/.env`
```
PAYMENT_DB_USER/PASSWORD
KEYCLOAK_*
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL
PAYMENT_SECRET_KEY
PAYMENT_RECONCILIATION_SECRET_KEY
ANTHROPIC_API_KEY           # Claude API for reconciliation
CLAUDE_MODEL
AUTH_SERVICE_API_KEY
SOCIETY_*
GMAIL_*
MINIO_*
SPLUNK_HEC_TOKEN
```

#### `services/visitor/.env`
```
VISITOR_POSTGRES_*          # Dedicated database
KEYCLOAK_*
INTERNAL_API_KEY
NOTIFICATION_SERVICE_URL
AUTH_SERVICE_API_KEY
SOCIETY_*
MINIO_*
SPLUNK_HEC_TOKEN
```

#### `services/notification/.env`
```
DB_*                        # Database connection
NOVU_*                      # Novu platform credentials
AUTH_SERVICE_*              # Fallback channel integration
GMAIL_*                     # Fallback email
KEYCLOAK_*
INTERNAL_API_KEY
USER_SERVICE_URL
SOCIETY_*
MINIO_*
USE_BACKGROUND_TASKS
SPLUNK_*
```

## How the Makefile Works

The `Makefile` has been updated to load all required `.env` files:

```bash
COMPOSE := docker compose \
  --env-file .env \
  --env-file db/.env \
  --env-file nginx/.env \
  --env-file frontend/.env \
  -f docker-compose.yml -f docker-compose.prod.yml
```

This means:
1. Variables in later files **override** earlier files
2. All files must exist or `make check-env` will auto-create them from `.example` versions
3. Each service container gets access to all variables (from all loaded `.env` files)

## Working with Individual Services

### Restart a Single Service
```bash
# From repo root, restart with Makefile
make restart-user-service
make restart-event-service

# Or manually with docker-compose
cd services/user
docker compose --env-file .env --env-file ../../db/.env \
  up -d --build

# Or from repo root, docker-compose loads all .env automatically
docker compose --env-file .env --env-file db/.env \
  --env-file nginx/.env --env-file frontend/.env \
  build user-service && \
  docker compose up -d user-service
```

### Full System Restart
```bash
make up          # Build and start all services
make restart     # Rebuild and restart all
make down        # Stop all services (data preserved)
make reset       # ⚠️  Wipe volumes and restart fresh
```

### View Logs
```bash
make logs              # All services
make logs-user         # User service only
make logs-events       # Event service only
make ps                # Health status
```

## Team Independence Benefits

With this structure:

- **Database Team**: Only manages `db/.env` (no need to see all service secrets)
- **Frontend Team**: Works with `frontend/.env` + builds independently
- **User Service Team**: Only needs `services/user/.env` + shared files like `.env` and `db/.env`
- **Event Service Team**: Only needs `services/event/.env` + shared files
- **Etc.**: Each service team has a minimal, focused set of variables

When a new developer joins a team:
1. Clone the repo
2. Copy `.example` files to `.env` files (Makefile does this automatically)
3. Get only their team's credentials (e.g., `services/user/.env`) from the team lead
4. Run `make up` or `make restart-user-service`
5. **No need to see unrelated service secrets**

## Cross-Repo References

These variables are shared between `my-society` and `~/auth-service`:

- `KEYCLOAK_URL` — Keycloak runs in `~/auth-service`
- `KEYCLOAK_PUBLIC_URL` — Public Keycloak access
- `KEYCLOAK_ADMIN_USER` — Used by `user-service` to manage Keycloak
- `KEYCLOAK_ADMIN_PASSWORD` — Shared between repos (set in both)

The Cloudflare tunnel is **only** in `~/auth-service`:
- If the public domain is unreachable, check `~/auth-service/podman-compose.yml`
- Run `make logs-cloudflared` to see tunnel logs

## Environment Precedence

Variables are loaded in this order (later overrides earlier):
1. `.env` (society-specific)
2. `db/.env`
3. `nginx/.env`
4. `frontend/.env`
5. Individual service `.env` files (if loaded directly)

## Migration Checklist

✅ Root `.env` cleaned to society-specific variables only  
✅ `db/.env` created with all database credentials  
✅ `nginx/.env` created with web server configuration  
✅ `frontend/.env` created with build variables  
✅ Each `services/*/. env` updated with service-specific variables  
✅ Makefile updated to load all `.env` files  
✅ Makefile `check-env` now verifies all files exist  
✅ `validate-ports` and `free-ports` read from correct files  

## Next Steps

1. **Document team credentials**: Each team should have a README showing which `.env` file to modify
2. **Backup real values**: Copy current prod `.env` files to a secure location
3. **CI/CD updates**: Update deployment scripts to set the correct `.env` files per stage
4. **Secrets management**: Consider using a secrets manager (Vault, AWS Secrets Manager, etc.) to populate these files in production

## Troubleshooting

### Error: "POSTGRES_PORT... not set. Defaulting to blank"
→ Make sure `db/.env` exists and has `POSTGRES_PORT=5432`

### Error: "INTERNAL_API_KEY not set"
→ Check that all service `.env` files have `INTERNAL_API_KEY=...` defined

### Error: "port 8080 already in use"
→ Check `nginx/.env` for `NGINX_PORT`, or run `make free-ports`

### One service won't start
→ Check logs: `make logs-<service>`  
→ Verify all required variables in `services/<service>/.env`
