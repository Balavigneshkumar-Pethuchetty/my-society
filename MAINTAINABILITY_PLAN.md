# Maintainability Plan

Status: Steps 1–6 all done (2026-08-30).
Origin: Architecture review following [DB_ISOLATION_PLAN.md](DB_ISOLATION_PLAN.md) and [SCALABILITY_PLAN.md](SCALABILITY_PLAN.md) (2026-08-27)

Progress:
- **Step 1 (docs)** — done. `THIRD_PARTY_LICENSES.md` Redis row corrected (Redis is provisioned but unused). `ARCHITECTURE.md` given an accuracy pass: added the missing `visitor-service` (3008) + `mfe-visitors`, removed the deleted `CollectorRegistry.tsx`, corrected the stale "resident checkout calls an external domain / SSE" gotcha (it's manual-only now), noted AI verification is disabled, added `LeaveRequests`/`CategoryManagement` to the admin-page table, dropped the `registrations.py` dead-code note (file now deleted).
- **Step 2 (dead code)** — `services/event/app/routes/registrations.py` deleted (was never mounted; registrations belong to registration-service) along with its now-orphaned models. **Not** removed: the large `DISABLED (manual-only payment flow)` commented blocks in `services/payment/app/routes/{payments,refunds}.py` — these are deliberately-parked AI-verification endpoints with explicit re-enable notes, not stray dead code. Decide separately whether to drop them (git history preserves them either way).
- **Step 3 (CI)** — `.github/workflows/ci.yml` added: per-service `docker compose build`, per-MFE `npm ci && npm run build` (tsc), and a conservative ruff pass (bug-only rules required, full rule set informational).
- **Step 4 (migration tracking)** — `db/migrations/032_add_migration_tracking.sql` adds a `schema_migrations` table (also in `01_schema.sql`). `make migrate` now skips already-recorded files, records each as it applies it, and stops on first error (`ON_ERROR_STOP`); new `make migrate-status` shows applied vs pending. First `make migrate` per environment re-applies everything once (idempotent) to backfill the table.
- **Step 5 (dedup)** — new `services/shared/` package (`db.py`, `auth_core.py`, `swagger_theme.py`) extracted after diffing every service's copy — narrower than originally scoped here: `notifications.py`/`email.py`/`splunk_logger.py` turned out to have real per-service business logic (not accidental duplication) and were left alone; `require_event_access`/`_has_event_access` (event vs. payment) were unified onto the null-safe variant event-service already depended on; user-service kept its own `require_role` (has a DB-fallback the other five don't — deliberate, not drift). All 6 backend services' Docker build `context` widened to the repo root (new root `.dockerignore` added) so `services/shared/` is visible to every Dockerfile; payment's Dockerfile was rewritten off its old unsafe `COPY . .` onto the same explicit two-stage pattern the other five already used. Verified service-by-service: builds, `/health`, and one role-gated + one `require_event_access`-gated route per service (401, not 500) before moving to the next.
- **Step 6 (test suite) — done.** All 6 backend services now have a `tests/` directory (28 tests total). Auth goes through FastAPI `dependency_overrides` on `get_current_claims` (`services/shared/testing.py`'s `fake_claims()`) — no real Keycloak needed. DB is real disposable `postgres:16-alpine` containers (`make test-db-up`/`test-db-down`), not the `.env.test` full stack (which needs Keycloak): a main one (port 5434, schema from `db/init/01_schema.sql` + `db/migrations/*.sql` + a new minimal `services/shared/test_seed.sql` — just the `SOCIETY_ID` row + `INR` currency, not `db/init/02_seed.sql`'s full demo dataset) for `event`/`payment`/`registration`/`ticket`/`user`, plus a **second** one (port 5436) for `visitor` specifically, since it has its own standalone database with no FKs into the main schema (`services/visitor/db/init/01_schema.sql` + its own `db/migrations/`). `make test` runs all of this end-to-end (per-service venvs cached at `services/<name>/.venv-test/`, gitignored); `.github/workflows/ci.yml`'s `backend-test` matrix job mirrors it with two GitHub Actions Postgres service containers, branching schema-load/env by `matrix.service == 'visitor'`.
  - **payment**: auth/role gates + the approve→verified confirmation flow, incl. registration status flip and audit-log row.
  - **ticket**: auth gate + `_ensure_tickets_issued` lazy-issuance, incl. idempotency on a second call and a pending-registration getting no ticket.
  - **event**: auth/role gates, `create_event` resolving the organizer and setting `draft` status, `require_event_access` (organizer vs. stranger vs. **admin — confirmed no bypass**, matching its "absolute isolation" docstring).
  - **registration**: auth/role gates on complimentary-ticket issuance, and the direct-not-lazy issuance path (registration + ticket + guest placeholder user, `role='guest'`/`keycloak_sub=NULL`, all created immediately — per `CLAUDE.md`'s ticket-issuance note).
  - **user**: targets `require_role()`'s local DB-fallback specifically (the one behavioral difference step 5 chose not to centralize) — JWT-only admin passes, DB-fallback-only admin passes, a DB resident with an empty JWT still gets rejected (not a blanket bypass).
  - **visitor**: `GET /gate/lookup/{token}` (auth/role gates, 404, success) — the one route in this service that doesn't also require mocking a live user-service over HTTP.
- **Seed data bug fix (2026-08-30, found while building step 6)** — `db/init/02_seed.sql` failed to load on any fresh database: it assigned `keycloak_sub = 'a1000000-0000-0000-0000-000000000009'` to two different users (Suresh Menon, line 201, and Ramu Kumar, line 223), violating `users_keycloak_sub_key`. Every other row in the file has `keycloak_sub`'s last segment matching its own `users.id`; Ramu Kumar's was a copy-paste of Suresh Menon's row above it. Fixed to `...000012` (matching Ramu Kumar's own id) — verified `01_schema.sql` + `02_seed.sql` now load cleanly on a fresh database.

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
