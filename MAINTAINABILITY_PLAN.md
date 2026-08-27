# Maintainability Plan

Status: Proposed — not started (planned for a weekend)
Origin: Architecture review following [DB_ISOLATION_PLAN.md](DB_ISOLATION_PLAN.md) and [SCALABILITY_PLAN.md](SCALABILITY_PLAN.md) (2026-08-27)

Unlike those two plans, everything here is either purely additive or a small, reversible refactor — nothing requires a schema change, a new infrastructure container, or a behavior change to a running service. Ordered so the zero-risk items go first.

## Order of work

### 1. Docs fixes (zero risk — text only)

- `THIRD_PARTY_LICENSES.md:26` claims Redis is used for "pub/sub messaging" — false, confirmed by grep that no service connects to Redis in code at all (see `SCALABILITY_PLAN.md` item 3). Fix the description.
- `ARCHITECTURE.md`'s job (per `CLAUDE.md`) is tracking which admin frontend pages are real vs. still-mock UI — worth a pass to confirm it's still accurate, since nothing currently forces it to stay in sync with the code.

### 2. Dead code removal (zero risk — not executed today)

- `services/event/app/routes/registrations.py` — a fully-written router with live-looking `registration`/`payment` table writes that is never mounted (`services/event/app/main.py:77-78` only registers `events.router`/`categories.router`). Either delete it or mount it deliberately if it was meant to be live — confirm which before removing.
- Commented-out code blocks left in place instead of deleted: `services/payment/app/routes/refunds.py:209-211`, `services/payment/app/routes/payments.py:486-488`.

### 3. CI pipeline (zero risk — additive only)

Add `.github/workflows/` with, at minimum: build each service's Docker image (`docker compose build <service>` per service, catches broken Dockerfiles/requirements before merge) and a linter pass (e.g. `ruff`/`flake8` for the Python services, `tsc`/`eslint` for the frontend MFEs — `tsc && vite build` already runs per-MFE per `CLAUDE.md`, so wiring that into CI is mostly just invoking what already exists). No existing behavior changes — this only adds a check.

### 4. Migration tracking table (zero risk — new migration only)

There are 32 files in `db/migrations/`, applied by hand via `make migrate`, relying entirely on each file's own `IF NOT EXISTS`/`DO $$` idempotency guards — no `schema_migrations` table records what's actually been applied where, so dev/prod drift (one environment missing a migration another has) is invisible until something breaks.

Add one new migration (`033_add_migration_tracking.sql`) creating a tracking table, and have `make migrate` (or a new `make migrate-status`) record/report against it. Doesn't touch any existing migration's SQL — purely additive.

### 5. Deduplicate cross-cutting code (small, reversible infra change — do one service at a time)

Three pieces of security/cross-cutting logic are copy-pasted across all six backend services, and have already drifted:

- **`app/auth.py`** (JWKS fetch, claims validation, role checks) — 51 to 135 lines per service. Diffed `event` vs `registration`: event has extra logic (`require_role_or_organizer`) the others lack. The *shared* parts (JWKS validation, algorithm allowlist) are six independent copies of security-critical code — a fix has to be manually applied six times today, and nothing catches a missed one.
- **`app/database.py`** (`wait_for_db`/`get_pool`) — byte-identical across all six services.
- **`notifications.py`** — near-duplicate in `user`, `event`, and `payment` services.

**Why this isn't purely additive**: each service's Docker build context is scoped narrowly (`docker-compose.yml` sets `context: ./services/<name>`, and each `Dockerfile` only `COPY app/ app/` from that directory) — a shared `services/_shared/` directory isn't visible to any single service's build as-is.

Two ways to fix that, both small and reversible:
1. Widen each service's build context to the repo root (`context: .` in `docker-compose.yml`, update each `Dockerfile`'s `COPY` paths to `services/<name>/app` and `services/_shared`) — a mechanical six-line diff across the compose file. Doesn't compromise `CLAUDE.md`'s "each service builds independently" property — `docker compose build <service>` still works fine with a wider context.
2. Or a Makefile pre-build step that copies `services/_shared/` into each service's directory before `docker build` runs — avoids touching `docker-compose.yml`, slightly hackier.

The code move itself (extracting the shared logic into `services/_shared/`) is a pure refactor with no behavior change. Do it one service at a time — swap event-service to the shared module, verify, then the next — so a mistake is isolated and easy to roll back, rather than converting all six simultaneously.

### 6. Test suite (biggest lift — do last, benefits from step 5 being done first)

`CLAUDE.md` confirms there's no test suite today (no pytest, no frontend test scripts). Since the services use raw `asyncpg` without a DI/repository abstraction, integration-style tests against a real test Postgres (rather than unit tests with mocked queries) are the natural fit — consistent with `.env.test.example` already existing in the repo (currently has an uncommitted local diff — check what's already been sketched there before starting, to avoid duplicating or clobbering in-progress work).

Start with the highest-blast-radius paths first rather than boiling the ocean: payment reconciliation/confirmation and ticket issuance are the two areas where a silent regression is most costly.

Doing this after step 5 means fewer places to write near-duplicate auth/DB-setup test scaffolding — the shared module only needs testing once instead of six times.

## What this plan does not cover

This is about existing-code hygiene and safety nets, not new capability. It doesn't include the DB schema/role separation (`DB_ISOLATION_PLAN.md`) or load-scaling changes (`SCALABILITY_PLAN.md`) — those remain separate, larger efforts.
