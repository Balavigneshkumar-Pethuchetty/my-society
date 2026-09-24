# Environment Variable Organization

This document explains how environment variables are segregated across this project.

## Overview

Instead of a monolithic `.env` file, environment variables are now distributed by component:

- **`.env`** — Global/shared configuration (project identity, authentication, inter-service auth)
- **`nginx/.env`** — Nginx reverse proxy settings
- **`db/.env`** — Database configuration (PostgreSQL, Redis, database roles)
- **`frontend/.env`** — Frontend build settings (Vite, feature flags)
- **`services/<service>/.env`** — Service-specific configuration

## File Structure

```
my-society/
├── .env                           # Global/shared variables
├── nginx/.env                     # Nginx only
├── db/.env                        # Database & Redis
├── frontend/.env                  # Frontend build vars
└── services/
    ├── user/.env                  # User Service
    ├── event/.env                 # Event Service
    ├── ticket/.env                # Ticket Service
    ├── registration/.env          # Registration Service
    ├── payment/.env               # Payment Service
    ├── visitor/.env               # Visitor Service
    └── notification/.env          # Notification Service
```

## Configuration by Component

### Root `.env` (Global/Shared)

**Purpose**: Variables shared across all services and platform components.

**Contents**:
- Project identity: `COMPOSE_PROJECT_NAME`, `SOCIETY_NAME`, `SOCIETY_SHORT_NAME`, `SOCIETY_CITY`
- Global URLs: `APP_PUBLIC_URL`, `KEYCLOAK_URL`, `KEYCLOAK_PUBLIC_URL`
- Inter-service auth: `INTERNAL_API_KEY`
- Keycloak admin credentials (managed in `~/auth-service`)
- Google OAuth credentials
- OTP Bridge credentials
- MinIO (object storage)
- Splunk monitoring
- Payment reconciliation secret (shared with `~/payment_reconcilation_service`)

### `nginx/.env`

**Purpose**: Nginx reverse proxy and web server configuration.

**Contents**:
- `NGINX_PORT` — Port nginx listens on (default 8080)
- `NGINX_ADMIN_USER`, `NGINX_ADMIN_PASSWORD` — Basic auth for admin panel
- pgAdmin access credentials (proxied through nginx)

**Usage**:
```bash
docker compose --env-file nginx/.env up -d nginx
```

### `db/.env`

**Purpose**: All database-related configuration.

**Contents**:
- PostgreSQL main database credentials and connection info
- Database role credentials (per-service schema isolation):
  - `EVENT_DB_USER` / `EVENT_DB_PASSWORD`
  - `TICKET_DB_USER` / `TICKET_DB_PASSWORD`
  - `USER_DB_USER` / `USER_DB_PASSWORD`
  - `PAYMENT_DB_USER` / `PAYMENT_DB_PASSWORD`
  - `REGISTRATION_DB_USER` / `REGISTRATION_DB_PASSWORD`
- Visitor Service dedicated Postgres (separate container)
- Redis cache credentials

**How it works**:
- These variables are referenced by all backend services
- Each service connects using its own role (for schema isolation and least privilege)
- When applying `db/migrations/033_event_service_schema_isolation.sql`, rotate each role's password to match the values here:
  ```sql
  ALTER ROLE event_role PASSWORD '<EVENT_DB_PASSWORD>';
  ALTER ROLE ticket_role PASSWORD '<TICKET_DB_PASSWORD>';
  -- etc.
  ```

**Usage**:
```bash
# Start just the database stack
docker compose --env-file db/.env up -d society_postgres redis pgbouncer
```

### `frontend/.env`

**Purpose**: Shared configuration for all frontend MFEs (micro-frontends).

**Contents**:
- Build mode: `VITE_MODE`, `VITE_APP_ENV`
- Feature flags: `VITE_GOOGLE_LOGIN`, `VITE_PHONE_LOGIN`
- Public URLs

**Usage**: Referenced by all MFE docker builds in `services/frontend/*/Dockerfile`

### `services/user/.env`

**Purpose**: User Service (user management, apartments/units, building structure, PII encryption)

**Contents**:
- Database role credentials (`USER_DB_USER`, `USER_DB_PASSWORD`)
- PII encryption keys (for `users.phone`, `users.email`)
- Keycloak authentication URLs
- Inter-service communication (notification-service)
- Auth service integration (OTP)
- Society configuration
- Shared credentials (MinIO, Gmail SMTP)

### `services/event/.env`

**Purpose**: Event Service (event CRUD, categories, ticket types)

**Contents**:
- Database role credentials (`EVENT_DB_USER`, `EVENT_DB_PASSWORD`)
- Redis cache credentials
- Keycloak authentication URLs
- Inter-service communication
- Society configuration
- UPI payment details (for ticket payment info)
- Email configuration

### `services/ticket/.env`

**Purpose**: Ticket Service (issuance, QR codes, gate scanning, event roster)

**Contents**:
- Database role credentials (`TICKET_DB_USER`, `TICKET_DB_PASSWORD`)
- Keycloak authentication URLs
- Inter-service communication
- Society configuration

### `services/registration/.env`

**Purpose**: Registration Service (registration cart, manual-payment review, complimentary tickets)

**Contents**:
- Database role credentials (`REGISTRATION_DB_USER`, `REGISTRATION_DB_PASSWORD`)
- Keycloak authentication URLs
- Inter-service communication
- Society configuration
- UPI payment details
- MinIO configuration

### `services/payment/.env`

**Purpose**: Payment Service (UPI reconciliation, refund queue, IMAP/LLM parsing)

**Contents**:
- Database role credentials (`PAYMENT_DB_USER`, `PAYMENT_DB_PASSWORD`)
- Encryption keys (`PAYMENT_SECRET_KEY` for committee registry IMAP passwords)
- AI provider config (`CLAUDE_MODEL`, `ANTHROPIC_API_KEY` for Claude provider)
- Payment reconciliation secret (shared with `~/payment_reconcilation_service`)
- Service mode (`PAYMENT_SERVICE_ENV=testing` for test endpoints)
- Keycloak authentication URLs
- Auth service integration
- Society configuration
- Email configuration (for IMAP polling)
- MinIO configuration

### `services/visitor/.env`

**Purpose**: Visitor Service (visitor management, separate Postgres)

**Contents**:
- Dedicated Postgres credentials (`VISITOR_POSTGRES_*`)
- Keycloak authentication URLs
- Inter-service communication
- Auth service integration
- Society configuration
- MinIO configuration

### `services/notification/.env`

**Purpose**: Unified notification routing (Novu templates + legacy SMS/email fallback)

**Contents**:
- Environment and debug settings
- Database access (pgBouncer)
- Novu API credentials and strategy
- Fallback channel credentials (auth-service for SMS/Telegram, Gmail for email)
- Keycloak authentication URLs
- Inter-service communication
- Society configuration
- Async processing settings
- Splunk monitoring

## How to Update Configuration

### Adding a new environment variable

1. **Identify the component** it belongs to (service, platform, etc.)
2. **Add it to the appropriate `.env` file**:
   - If shared across multiple services → root `.env`
   - If specific to one service → `services/<service>/.env`
   - If infrastructure → `db/.env`, `nginx/.env`, or `frontend/.env`
3. **Document it** with a comment block explaining its purpose
4. **Add to `.env.example`** file as a template for new deployments

### Deploying with segmented .env files

From the repo root:

```bash
# Start the full stack (uses root .env + service-specific .env files)
make up

# Or manually with docker-compose:
docker compose --env-file .env --env-file db/.env --env-file nginx/.env up -d

# Restart a single service with its .env
docker compose --env-file services/payment/.env --env-file db/.env up -d --build payment-service
```

**Note**: `docker-compose.yml` sources variables from:
1. Root `.env` (if present)
2. Service-specific `.env` files (via `--env-file` flags in scripts/Makefile)

### Creating `.env.example` templates

Each `.env` file should have a corresponding `.env.example` as a template:

```bash
# For a new service:
cp services/myservice/.env services/myservice/.env.example
# Then edit .env.example to remove secrets (leave placeholders)
```

## Security Best Practices

1. **Never commit `.env` files to git** — they contain secrets
2. **Always commit `.env.example`** — these are public templates
3. **Rotate secrets regularly** — especially API keys and passwords
4. **Use strong passwords** — especially for database roles
5. **Restrict .env file permissions**:
   ```bash
   chmod 600 .env nginx/.env db/.env services/*/.env frontend/.env
   ```

## FAQ

**Q: Which `.env` file should I edit to change the Keycloak URL?**
A: The root `.env` (because Keycloak URL is used by all services).

**Q: How do I change just the payment-service database password?**
A: Edit `db/.env` (`PAYMENT_DB_PASSWORD`) AND `services/payment/.env` to keep them in sync.

**Q: Can a service read from multiple `.env` files?**
A: Yes, docker-compose can load multiple via `--env-file` flags. The Makefile handles this automatically.

**Q: What if I want different .env files for dev/staging/prod?**
A: Create variations (e.g., `.env.staging`, `db/.env.prod`) and reference them in deploy scripts:
```bash
docker compose --env-file .env.prod --env-file db/.env.prod up -d
```

**Q: How do I know which variables a service actually needs?**
A: Check the service's `Dockerfile` or `app/settings.py` for `os.getenv()` calls, and refer to its `.env.example`.
