# Scalability Plan

Status: Proposed — not started
Origin: Architecture review following [DB_ISOLATION_PLAN.md](DB_ISOLATION_PLAN.md) (2026-08-27)

Ideas for scaling this application beyond its current single-host, single-replica-per-service deployment. These are independent of the schema-isolation work in `DB_ISOLATION_PLAN.md`, though PgBouncer (below) will naturally overlap with that plan's per-service connection changes. See also [MAINTAINABILITY_PLAN.md](MAINTAINABILITY_PLAN.md) for code-hygiene/testing/CI work independent of both.

## Priority order

### 1. Fix the payment reconciliation loop before scaling payment-service replicas — blocker, not optimization

`services/payment/app/main.py:27` starts `asyncio.create_task(reconciliation_inbox.reconciliation_loop())` on every process startup — an infinite `while True` IMAP-polling loop ([inbox.py:59](services/payment/app/reconciliation/inbox.py#L59)) running *inside* the FastAPI app process itself, polling each event's configured mailbox (`committee_registry.imap_host/user/password/mailbox`) for payment screenshots.

If `payment-service` is ever scaled to N replicas for API throughput, N independent copies of this loop would run concurrently against the same mailboxes — duplicate IMAP fetches, and a race to process the same incoming screenshots. This must be extracted into a single dedicated worker (or gated with a leader-election / advisory-lock guard so only one replica runs it) **before** payment-service can be horizontally scaled at all. Treat this as a hard prerequisite, not a nice-to-have.

### 2. Externalize uploads to object storage (MinIO / S3-compatible)

Four services write directly to local Docker named volumes, mounted at `/app/uploads`:
- `user-service` → `user_uploads` (avatars — `services/user/app/main.py:26`)
- `registration-service` → `registration_uploads` (payment screenshots — `services/registration/app/main.py:22`)
- `visitor-service` → `visitor_uploads` (`services/visitor/app/main.py:27`)
- `payment-service` → `payment_uploads` (`services/payment/app/uploads.py:27-29`)

This works fine at one replica per service on one host — a named volume mounted into multiple replica containers on the *same* host is shared and works correctly. It becomes a hard blocker the moment replicas are spread across multiple hosts (Docker Swarm nodes, Kubernetes pods) since local volumes aren't shared across hosts. Migrate these four upload paths to an S3-compatible store (MinIO is a reasonable self-hosted choice given the rest of the stack is self-hosted) before any multi-host scaling plan, not after.

### 3. Actually use Redis

Redis is already provisioned in `docker-compose.yml` (LRU eviction cache, `redis_data` volume) but **zero application code connects to it** — confirmed by grepping `import redis|redis\.|Redis\(` across every `services/*/app` tree. It's fully idle infrastructure today.

Caching hot, read-heavy, rarely-changing endpoints (event listings, categories, ticket types) would cut Postgres load cheaply. This is independent of every other item on this list and carries the least risk — safe to do any time, doesn't block on or get blocked by anything else here.

### 4. Connection pooling in front of Postgres (PgBouncer)

Each service creates its own `asyncpg` pool with `min_size=2, max_size=10` (identical shape in all six `services/*/app/database.py` files, e.g. [services/event/app/database.py:11](services/event/app/database.py#L11)). Fine at one replica each. Once any service is scaled to multiple replicas (item 5 below), `max_connections` on the single Postgres instance becomes the ceiling before CPU does — 6 services × N replicas × up to 10 connections each adds up fast.

This overlaps with `DB_ISOLATION_PLAN.md`'s schema-per-service work (which already touches each service's DB credentials/connection config) — sequence PgBouncer introduction alongside that work rather than as a separate migration.

### 5. Horizontal replica scaling of the stateless FastAPI services behind nginx

Once items 1–2 are done (no in-process singleton loops, no local-disk-only state), scale with `docker compose up -d --scale <service>=N` and an nginx `upstream` block per service instead of proxying to a single container's DNS name. This is the generic "more load → more containers" lever, but it's gated on items 1 and 2 — scaling before those are fixed would duplicate the reconciliation loop and/or fragment uploaded files across replicas.

### 6. CDN for the built frontend MFE bundles

The Cloudflare tunnel is already the public entry point (see `CLAUDE.md`'s ingress table — `gm-global-techies-town.club` → this repo's nginx). Fronting the built static JS bundles (`frontend/shell` + the 5 `mfe-*` remotes) with Cloudflare's CDN caching is a small config change that offloads static asset serving from nginx/the containers entirely, leaving them to handle only API traffic.

## What this plan does not cover

This is about *this application's* compute/data layer scaling to more load on the existing single-society deployment. It does not address multi-tenancy (onboarding additional societies) — `SOCIETY_ID` is a single hardcoded constant per `CLAUDE.md`, and making that configurable per-tenant is a separate, larger architectural question not in scope here.

## Immediate next action

Item 3 (Redis) is the lowest-risk starting point — no dependencies on anything else, purely additive. Item 1 (reconciliation loop) is the most urgent to fix even though nothing forces the timeline, since it's silently unsafe the moment anyone scales payment-service without knowing about it.
