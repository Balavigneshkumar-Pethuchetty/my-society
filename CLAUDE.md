# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For a per-service feature breakdown (exact endpoints owned by each backend service, and — importantly — which admin frontend pages are real vs. still hardcoded mock UI with no backend), see [ARCHITECTURE.md](ARCHITECTURE.md).

## Commands

```bash
# Core lifecycle
make up                      # start all services (builds if needed)
make down                    # stop containers (data preserved in volumes)
make restart                 # rebuild and restart all
make reset                   # ⚠ wipe volumes + restart fresh
make ps                      # health status of all containers
make logs                    # follow all logs

# Individual service rebuild+restart (after code changes)
make restart-user-service | restart-event-service
make restart-mfe-admin | restart-mfe-events | restart-mfe-booking | restart-mfe-payment
make restart-nginx           # picks up nginx.conf changes
# registration-service, ticket-service, payment-service have no dedicated make target —
# use: docker compose build <service> && docker compose up -d <service>

# Logs (per service)
make logs-nginx | logs-db | logs-user | logs-events | logs-mfe-admin | logs-mfe-booking | logs-mfe-events | logs-mfe-payment

# Database
make shell-db                 # psql in society_events
make shell-redis              # redis-cli
make seed                     # re-run seed SQL (idempotent)
make migrate                  # apply not-yet-recorded db/migrations/*.sql in order (idempotent; tracked in schema_migrations)
make migrate-status           # list which migrations are applied vs still pending
# A single migration can also be applied by hand:
docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/0NN_name.sql

# Frontend dev (hot reload, without Docker)
make frontend                 # shell app on http://localhost:3000
make frontend-install         # npm install only for all frontend packages
# Each MFE can also be run standalone from its own directory:
#   cd frontend/mfe-admin && npm run dev   (see vite.config.ts for its dev port)
```

There is no test suite in this repository (no pytest, no frontend test scripts) — don't invent test commands.

Each Python service builds independently: `docker compose build <service-name>` then `docker compose up -d <service-name>`. Each frontend MFE builds via `npm run build` (`tsc && vite build`) inside its own Dockerfile; `docker compose build <mfe-name>` triggers this.

### Per-service compose files (standalone build/redeploy of one service)

Every backend service and frontend app also has its own `docker-compose.yml` + `.env`/`.env.test` (real values, gitignored) + `.env.example`/`.env.test.example` (tracked templates) in its own directory (`services/<name>/`, `frontend/<name>/`). These are **not** a replacement for the root `docker-compose.yml` — they assume the shared platform (postgres, pgbouncer, redis, minio, and the `${COMPOSE_PROJECT_NAME}_network` Docker network) is already up via `make up` from the repo root, and they intentionally have no `depends_on` (impossible across separate compose projects). Because each file's `COMPOSE_PROJECT_NAME` defaults to the same project as the root file (`society`/`society-test`), running one attaches to and transparently redeploys that exact service within the already-running stack — it does not spin up a parallel copy. Backend build contexts point at the repo root (`context: ../..`) since their Dockerfiles `COPY services/shared/`; frontend build contexts are self-contained (`context: .`). `visitor-service`'s file is the one exception that's genuinely self-contained — it bundles its own dedicated `visitor-postgres`, matching its existing architecture (see below).

Usage, from inside the service's own directory:
```bash
docker compose --env-file .env up -d --build         # rebuild+redeploy against the default stack
docker compose --env-file .env.test up -d --build    # same, against the test stack
```

## Architecture

### Single-tenant, shared-database microservices

Every backend service connects to the **same** PostgreSQL database (`society_events`) and every query is scoped by a single hardcoded `SOCIETY_ID` constant (from `settings.society_id`, default `11100000-0000-0000-0000-000000000001`). This is not a multi-tenant system — there is one society. Services routinely read/write tables that "belong" to another service (e.g. `registration-service` writes directly to `ticket`, `payment_transaction`, and `complimentary_ticket`) rather than making cross-service HTTP calls — this is the established pattern here, not an anti-pattern to fix.

### Database schema: two-layer, and migrations do NOT auto-apply

- `db/init/01_schema.sql` — the full DDL baseline. Only executes automatically via `docker-entrypoint-initdb.d` when the Postgres data volume is created for the first time. Editing this file has **no effect** on an already-initialized volume.
- `db/migrations/0NN_*.sql` — incremental, numbered, idempotent (`IF NOT EXISTS` / `DO $$ ... $$` guards) changes. These must be applied manually with `docker exec -i society_postgres psql ... < file` (or `make migrate`, which now applies only files not yet recorded in the `schema_migrations` table and records each as it runs; `make migrate-status` shows applied vs pending) — they are never run automatically on container restart.
- When adding a schema change: write both a new numbered migration file **and** the equivalent change to `01_schema.sql` (so fresh installs match), then apply the migration by hand against the running DB.

### Backend services (FastAPI, one per bounded context)

| Service | Port | Nginx prefix | Owns |
|---|---|---|---|
| user-service | 3001 | `/api/users/` | users, roles, apartments/units, building structure |
| event-service | 3002 | `/api/events/` | event CRUD, categories, ticket types |
| registration-service | 3005 | `/api/registrations/` | registrations, cart, manual-payment review, complimentary tickets, ticket cancellation |
| ticket-service | 3006 | `/api/tickets/` | ticket issuance/QR, gate scan/entry, event roster |
| payment-service | 3007 | `/api/payments/` | centralized UPI payment reconciliation (`payment_transaction`), refund queue |
| visitor-service | 3008 | `/api/visitors/` | visitor management (dedicated Postgres) |
| notification-service | 3009 | `/api/notifications/` | unified notification routing (Novu + legacy fallback) |

All services validate JWTs against the same Keycloak JWKS endpoint and gate routes with a `require_role(*roles)` dependency checking `realm_access.roles` from the token. Known roles: `admin`, `committee_member`, `resident`, `security_guard`, `sponsor`.

### Unified notification service — single point for all notifications

**notification-service** is a centralized microservice that handles all notification delivery across the system. Instead of each service implementing its own notification logic, they make HTTP calls to notification-service, which then routes the notification based on a configurable strategy.

**Architecture:**
- **Strategy-based routing**: `NOVU_ONLY`, `NOVU_WITH_FALLBACK` (default), or `FALLBACK_ONLY` — set via `NOVU_STRATEGY` env var
- **Novu primary**: Novu event-triggered templates with full delivery tracking
- **Legacy fallback**: SMS/Telegram (via `auth-service`), Email (via Gmail SMTP) when Novu fails or disabled
- **In-app notifications**: Stored in `user-service` for dashboard display
- **Audit trail**: All sent notifications logged in `notification.notification_logs` table

**How other services use it:**
```python
async with httpx.AsyncClient() as client:
    await client.post(
        "http://notification-service:3009/api/notifications/send",
        json={
            "user_id": user_id,
            "event_name": "refund_approved",  # Novu template name
            "payload": {"amount": 100, "currency": "INR"},
            "user_phone": "+91-xxx",
            "user_email": "user@example.com",
            "legacy_message": "Your refund has been approved",
            "notify_sms": True,
            "notify_email": True,
        },
        headers={"X-Api-Key": settings.internal_api_key},
    )
```

**Configuration:**
- Enable/disable Novu, email, SMS/Telegram independently via env vars
- Fallback strategy allows graceful degradation if Novu is down
- Background task processing (`USE_BACKGROUND_TASKS=true`) queues sends instead of blocking

### Two parallel payment systems — know which one is live

- **Legacy manual-payment flow**: `registration-service`'s `payment` table (`pending_screenshot` → `pending_review` → `approved`/`rejected`), reviewed via the admin `PaymentApprovals.tsx` page.
- **Centralized reconciliation flow**: `payment-service`'s `payment_transaction` table (`pending` → `verified` → `refund_requested` → `refunded`), driven by UPI screenshot auto-verification (SSE push to the frontend) and a `RefundTasks.tsx` admin queue.

`frontend/mfe-payment/src/PaymentApp.tsx` (the resident checkout flow) currently uses the **reconciliation** flow. New refund-triggering features (e.g. ticket cancellation) should hook into `payment_transaction`, not the legacy `payment`/`refund` tables — the original `refund` table in the base schema is dead/unused schema with no routes.

### Ticket issuance is lazy or direct, never both

- Paid/free resident checkouts: a `ticket` row is created **lazily** the first time `GET /tickets/my` is called for a `confirmed` registration (`_ensure_tickets_issued` in `ticket-service`).
- Complimentary tickets (admin-issued): `registration-service` creates the `registration` + `ticket` rows **directly and immediately** at issue time (no lazy step), because the guest needs the QR right away and may not even be able to log in to trigger the lazy path themselves.
- A guest without a resident account gets a lightweight placeholder `users` row (`role='guest'`, no `keycloak_sub`, so it can never authenticate) purely to satisfy FK constraints on `registration`/`ticket`.

### Frontend: shell + module federation, URL-driven remote routing

`frontend/shell` is the host app; `frontend/mfe-{admin,events,booking,payment,tickets}` are independently buildable/deployable remotes (`@originjs/vite-plugin-federation`), each servable standalone on its own dev port (4001–4005, see `frontend/shell/vite.config.ts` for the mapping) or bundled in production behind nginx at `/mfe-*/`.

The shell does not use nested React Router routes for admin/manage sections — instead wrapper components (`ManageWrapper`, `AdminWrapper` in `shell/src/App.tsx`) split the URL path into `page`/`id` segments (e.g. `/manage/complimentary/{eventId}` → `page='complimentary'`, `id=eventId`) and pass them as props into the remote's own dispatcher component (`ManageRoutes`/`AdminRoutes`), which does an if/else on `page` to pick the actual page component. When adding a new admin sub-page, it must (a) accept `token`/`id` props, (b) handle the no-`id` case gracefully, and (c) be added to the dispatcher's if-chain — grep for an existing entry (e.g. `TicketTypeSetup`) as the template.

`mfe-admin` is not just "admin" — it exposes three unrelated route trees from one remote: `ManageRoutes` (`/manage/*`), `AdminRoutes` (`/admin/*`), and `SponsorApp` (`/sponsor`).

### Auth is centralized outside this repo

Keycloak (and its Cloudflare tunnel) now live in a **separate sibling project** (`~/auth-service`), not in this repository — `KEYCLOAK_URL`/`KEYCLOAK_PUBLIC_URL` point at `https://auth.gm-global-techies-town.club`.

Be aware there is also a **separate, standalone** sibling project `~/payment_reconcilation_service` (its own docker-compose, own Postgres, own Ollama containers) doing functionally similar work (IMAP polling + LLM-based screenshot parsing for UPI reconciliation), but it is not the same codebase as this repo's `services/payment` — this repo's `services/payment` has its own independent IMAP/Ollama reconciliation code (`app/reconciliation/`) and is the one actually wired into this repo's docker-compose/nginx. When debugging payment reconciliation, confirm which of the two you're actually looking at before searching further.

### Cloudflare tunnel — public reachability lives entirely outside this repo

None of this repo's `docker-compose.yml`/nginx config makes the site publicly reachable by itself — a single Cloudflare Tunnel, defined and run from `~/auth-service`, does that. If the public domain (`gm-global-techies-town.club` or any subdomain) is unreachable but `make ps` shows this repo's containers healthy, the problem is almost always in `~/auth-service`, not here.

- **Tunnel config**: `~/auth-service/cloudflared/config.yml` (ingress rules mapping hostname → local service) + a credentials JSON keyed by tunnel UUID in the same directory.
- **Tunnel container**: service `cloudflared` in `~/auth-service/podman-compose.yml` (a *different* compose project, run with `podman-compose`, not this repo's `docker-compose.yml`).
- **Convenience targets from this repo**: `make logs-cloudflared` / `make restart-cloudflared` just `cd ~/auth-service && podman-compose logs/restart cloudflared` under the hood.

Current ingress mapping (from `config.yml`):

| Hostname | Routes to |
|---|---|
| `gm-global-techies-town.club`, `www.` | `http://host.containers.internal:8080` — **this repo's** nginx (`NGINX_PORT`) |
| `auth.gm-global-techies-town.club` | Keycloak, inside the auth-service Podman stack |
| `auth-api.gm-global-techies-town.club` | auth-service's own backend container |
| `pay.gm-global-techies-town.club` | `host.containers.internal:8001` — the standalone `payment_reconcilation_service` |
| `chat.gm-global-techies-town.club` | `host.containers.internal:8082` — Ollama Chat |
| `pgadmin.gm-global-techies-town.club` | this repo's nginx → pgadmin |
| `splunk.gm-global-techies-town.club` | `host.containers.internal:8002` — centralized `~/splunk-service` |

When the site is unreachable, check in this order:
1. `cd ~/auth-service && podman-compose ps` — is the `cloudflared` container actually running (and healthy)? Its healthcheck runs `cloudflared tunnel ... ingress validate`, so a failing healthcheck usually means a config.yml syntax/ingress problem, not a network outage.
2. `make logs-cloudflared` (or `podman-compose logs cloudflared` in `~/auth-service`) — look for connection/auth errors against Cloudflare's edge, or "no ingress rule matched" for the requested hostname.
3. Does `config.yml`'s port for `gm-global-techies-town.club` (`8080` by default) still match this repo's actual `NGINX_PORT` in `.env`? These are **not** kept in sync automatically — changing one without the other silently breaks public access while `localhost` access still works fine.
4. Is the credentials JSON (`~/auth-service/cloudflared/<tunnel-uuid>.json`) present and does its filename match the `tunnel:`/`credentials-file:` UUID at the top of `config.yml`?
5. Remember `host.containers.internal` only resolves from inside the Podman network the tunnel runs in — if a target service moved to a different port or a different compose project, the ingress rule needs a manual update in `config.yml` and a `restart-cloudflared`, since nothing reloads it automatically.
