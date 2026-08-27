# Database Decomposition & Service Isolation Plan

Status: Proposed — not started
Origin: Engineering review of a "Database-per-Service" ERD against the current shared-database architecture (2026-08-27)

See also [SCALABILITY_PLAN.md](SCALABILITY_PLAN.md) for broader scaling ideas (replica scaling, object storage, caching, connection pooling) beyond this document's schema-isolation scope, and [MAINTAINABILITY_PLAN.md](MAINTAINABILITY_PLAN.md) for code-hygiene/testing/CI work independent of both.

## Decision: schema-per-service in one Postgres instance, not physical DB-per-service

The original ERD proposed a full physical database-per-service split (separate Postgres instance per service, event bus, sagas, OpenTelemetry). After auditing the current codebase, we're taking a lower-risk path first: **per-service PostgreSQL schemas inside the existing `society_events` database**, with DB roles enforcing that each service can only read/write its own schema.

This gets us the actual goal — no service silently writing another service's tables — without the operational cost of running and backing up N more Postgres instances, and without having to solve cross-database FK removal and event-driven cascade-deletes on day one (Postgres schemas in the same DB still support real FKs and JOINs across schemas; cross-*database* FKs do not exist at all, which is what makes the full-physical-split version much harder).

`services/visitor` already proves the *fully* isolated end-state works (own Postgres instance, own volume, no FK to `users`, cross-service reads resolved via `services/visitor/app/user_client.py` calling an internal HTTP endpoint on user-service) — that pattern is the reference for "internal API" calls below, and remains the option to fall back to per-service later if schema isolation turns out not to be enough (see "What schema isolation does not give us").

## Audit findings (current state, as of 2026-08-27)

### Cross-domain direct writes (the actual problem to fix)

- `services/registration/app/routes/complimentary.py:102` — `INSERT INTO users (...)` (guest placeholder account)
- `services/registration/app/routes/complimentary.py:114` — `INSERT INTO ticket (...)`
- `services/registration/app/routes/complimentary.py:120,256` — `INSERT INTO complimentary_ticket (...)`
- `services/registration/app/routes/complimentary.py:170,227` — `UPDATE complimentary_ticket ...`
- `services/registration/app/routes/complimentary.py:177` — `UPDATE ticket SET status = 'cancelled' ...`
- `services/registration/app/routes/registrations.py:352` — `UPDATE ticket SET status = 'cancelled' ...`
- `services/registration/app/routes/registrations.py:374` — `UPDATE payment_transaction SET status = 'refund_requested' ...`
- `services/registration/app/routes/registrations.py:380` — `INSERT INTO payment_audit_log (...)`
- `services/ticket/app/routes/tickets.py:253,354` — `UPDATE registration SET status = 'attended' ...` (line 353 has an in-code comment acknowledging the shared-DB pattern)
- `services/payment/app/reconciliation/inbox.py:232` — `UPDATE registration SET status='confirmed' ...`
- `services/payment/app/adapters/manual_upi.py:142` — `UPDATE registration SET status='confirmed' ...`
- `services/payment/app/routes/payments.py:862` — `UPDATE registration SET status='confirmed' ...`
- `notification` table written directly by three services with no single owner: `services/user/app/notifications.py:45`, `services/user/app/routes/internal.py:183`, `services/user/app/routes/leave_requests.py:94`, `services/event/app/notifications.py:36`, `services/payment/app/notifications.py:47,85,151`

Dead code, not counted above: `services/event/app/routes/registrations.py` writes `registration`/`payment` but is never mounted (`services/event/app/main.py:77-78` only registers `events.router`/`categories.router`).

Not yet audited: cross-domain **read-side** `JOIN`s (e.g. admin lists that join `registration` to `event` for the event name). This needs a grep pass before schema-per-service work starts, since those queries break the moment tables move to schemas the querying service's role can't see.

### FK / cascade-delete surface that changes shape under this plan

Cross-domain FKs (full list captured during the audit): `ticket.reg_id/user_id/event_id/scanned_by`, `payment_transaction.event_id/registration_id/user_id`, `committee_registry.event_id/member_id/assigned_by`, `registration.event_id/user_id`, `registration_item.ticket_type_id`, `complimentary_ticket.event_id/invited_by_user_id/registration_id/guest_user_id/created_by`, `event.organizer_id`, `event_sponsorship`/`sponsorship_refund`/`event_expense`/`event_vendor`/`vendor_revenue_distribution`/`distribution_entry`/`fund_export_link` → `event(id)`/`users(id)`, `event_permission.event_id/user_id/granted_by`, `notification.user_id/event_id`, `cart.user_id/event_id`.

`ON DELETE CASCADE` is used pervasively across these (e.g. `db/migrations/022_event_delete_cascade_payments.sql`). Because schema-per-service keeps everything in one database, these FKs **can be left in place** initially — schema isolation is enforced via role GRANTs, not by removing FKs. Removing FKs / replacing cascades with application-level cleanup is deferred to a later decision point (see "Future option").

### No event bus, no tracing (confirmed absent)

- No RabbitMQ/Kafka/Celery/NATS anywhere in `docker-compose.yml` or any `requirements.txt`.
- Redis is running (`docker-compose.yml`) but is LRU session/rate-limit cache only — grep of all `services/*/app` found **zero** code actually connecting to Redis. `THIRD_PARTY_LICENSES.md:26` claims Redis is used for "pub/sub messaging" — this is inaccurate/aspirational and should be corrected independently of this plan.
- No OpenTelemetry / correlation-ID / trace-ID code anywhere in the Python services.

### Tenancy

`SOCIETY_ID` is a single hardcoded UUID (`11100000-0000-0000-0000-000000000001`) duplicated in every service's `config.py` and in `docker-compose.yml` env vars. Not affected by this plan; noted for completeness.

## Target service order (safest → hardest)

Ranked by how much cross-domain write surface has to be fixed before that service's tables can move into their own schema+role:

1. **event-service** — `event`/`event_category`/`ticket_type` have no live cross-domain writes into them today (only test-only code in `services/payment/app/routes/testing.py`, gated behind `PAYMENT_SERVICE_ENV=testing`, touches `event`). Read-side JOIN audit still needed first.
2. **ticket-service** — one inbound write direction to fix: registration-service's writes to `ticket` (complimentary issue/cancel).
3. **user-service** — high fan-in (nearly every table FKs to `users`) but the data model itself doesn't change; one inbound write to fix (registration-service's guest-account creation).
4. **payment-service** — two-way cross-writes with registration-service (confirm/refund-request). Extract after the pattern is proven on 1–3; money-handling code, so extra burn-in before cutover.
5. **registration-service** — the hub. By the time steps 1–4 are done, most of its cross-writes into other services will already have been converted to internal-API calls as a side effect of those steps, so what's left here is small.

`visitor-service` is already isolated (own Postgres instance) — no work needed.

## Per-service migration recipe (repeat for each of the 5 services above)

1. **Read-path via internal API, schema still shared.** Add `/internal/*` endpoints on the owning service (mirror `services/visitor/app/user_client.py`'s pattern) and replace cross-domain SQL `JOIN`s in other services with calls to them. No DB change. Fully reversible.
2. **Write-path via internal API, schema still shared.** Replace each raw cross-domain `INSERT`/`UPDATE` (see file:line list above) with a call to the owning service's own internal write endpoint. Still the same tables underneath — reversible, but this is the step that actually stops other services from touching this service's data directly.
3. **Cascade-delete behavior, written and tested before the schema move.** Confirm `ON DELETE CASCADE` still works as-is post-move (it will, since everything stays in one database) — but re-verify with an integration test (delete an event/registration/ticket end-to-end, assert no orphans) since role GRANTs could otherwise silently block a cascade from firing if the deleting role lacks privileges on the cascaded-into schema.
4. **Move tables into the service's schema + swap credentials.**
   ```sql
   CREATE SCHEMA IF NOT EXISTS <service>_svc;
   ALTER TABLE <table> SET SCHEMA <service>_svc;   -- per owned table

   CREATE ROLE <service>_role LOGIN PASSWORD '...';
   GRANT USAGE ON SCHEMA <service>_svc TO <service>_role;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA <service>_svc TO <service>_role;
   ALTER ROLE <service>_role SET search_path = <service>_svc;
   ```
   Point that service's DB connection at the new role/credentials (same host/port/database — `society_events` — just a different role and `search_path`). Any remaining cross-domain SQL that steps 1–3 missed will now fail loudly with `permission denied for schema ...` instead of silently succeeding — treat that as the integration-test signal that step 1/2 wasn't complete, not as a production surprise.
   Update `db/init/01_schema.sql` and add a new `db/migrations/0NN_*.sql` for the schema move, per the two-layer rule in `CLAUDE.md`.
5. Keep the table accessible (read-only grant) from the old default role for one release as a rollback window before fully cutting over.

## What to defer (do not front-load)

- **No message broker (RabbitMQ/Kafka) until there's an actual saga to justify it** — likely only needed for the Registration→Payment→Ticket workflow once services 2/4/5 above are separated. Steps 1–2 of the recipe (synchronous internal REST calls) are sufficient until then.
- **Correlation-ID propagation is cheap and worth doing early**, ahead of step 1 on the first service — a single header generated at the nginx/shell layer and forwarded through internal `httpx` calls makes every later step easier to debug. Not full OpenTelemetry, just a request-ID passthrough to start.

## What schema isolation does not give us (be honest about this later)

Still one Postgres process — a runaway query or resource spike on payment-service's schema can still degrade event-service (no true fault isolation), and the DB tier can't be scaled per-service independently. If that's never actually hit in practice (single-host, single-society deployment), schema isolation may be the permanent right answer. If it is hit later, `pg_dump -n <schema>` + `pg_restore` into a dedicated instance (i.e. finishing the move to the visitor-service pattern) is the well-understood next step from here — this plan is a checkpoint, not a dead end.

## Immediate next action

Before touching event-service: grep `services/registration`, `services/ticket`, `services/payment` for `JOIN event`, `JOIN event_category`, `JOIN ticket_type` (and similarly for `users`/`ticket`/`registration` ahead of their respective turns) to complete the read-side picture the write-side audit above doesn't cover.
