-- Registration-service schema isolation (DB_ISOLATION_PLAN.md, step 5 of 5 —
-- the last one).
--
-- Moves the 6 tables exclusively owned by registration-service — registration,
-- registration_item, cart, complimentary_ticket, payment (legacy manual-
-- payment flow), refund (legacy, dead/unused per CLAUDE.md but still cleaned
-- up on account deletion) — out of the shared `public` schema into their own
-- `registration_svc` schema, and creates a dedicated `registration_role`.
--
-- As the plan predicted, registration-service's own *outbound* cross-writes
-- were already fully converted to internal-API calls by steps 1, 2 and 4
-- (event_client.py, ticket_client.py, and payment_svc.payment_transaction/
-- payment_audit_log direct-but-qualified access) — confirmed by a fresh grep
-- finding zero remaining unqualified cross-schema SQL in registration-service's
-- own code before this migration. What *is* substantial: the **inbound**
-- direction — event-service (capacity counts), ticket-service (ticket/roster
-- JOINs + the gate-scan write to registration.status), payment-service
-- (confirm-on-verify writes + registration_item amount lookups + the legacy-
-- flow auto-verify JOIN), and user-service (leave-request/account-deletion)
-- all read/write these 6 tables directly. All four of those already had
-- table-level grants from their own isolation migrations (033-036) that
-- persist automatically across this `ALTER TABLE ... SET SCHEMA` — but, same
-- lesson as migration 036, table-level GRANT alone isn't reachable without
-- `USAGE` on `registration_svc` itself, which none of those roles had until
-- now. This migration adds it for all four. The consuming code in
-- `services/event/app/routes/events.py`, `services/ticket/app/routes/
-- tickets.py`, `services/payment/app/routes/payments.py` +
-- `reconciliation/inbox.py` + `adapters/manual_upi.py` + `routes/
-- quick_review.py`, and `services/user/app/routes/leave_requests.py` was
-- schema-qualified ahead of this migration.
--
-- Cross-schema FKs work exactly like same-schema ones in Postgres, and FK
-- enforcement (including ON DELETE CASCADE) runs with the constraint's own
-- privileges, not the invoking role's grants — so every existing FK into/out
-- of these 6 tables keeps working unchanged after the move. Re-verify this
-- empirically before relying on it (see DB_ISOLATION_PLAN.md's per-service
-- recipe step 3).
--
-- `v_event_finance` (a public-schema VIEW) LEFT JOINs `registration` — its
-- definition was updated in db/init/01_schema.sql to schema-qualify it, but
-- the already-existing view object in a live database needs the same
-- CREATE OR REPLACE treatment here (same as migration 036 did for the
-- payment_svc tables it also reads).
--
-- Also fixes two pre-existing `CLAUDE.md` two-layer-rule gaps found while
-- doing this: `cart` (added in db/migrations/007_cart.sql) had never been
-- added to `db/init/01_schema.sql` at all — it's in there now, as
-- `registration_svc.cart`.
--
-- Idempotent: ALTER TABLE ... SET SCHEMA is guarded with IF EXISTS against
-- each public.<table> (a no-op once already moved), and the role
-- creation/grants are safe to re-run.
--
-- IMPORTANT — after applying, immediately rotate the placeholder password:
--   ALTER ROLE registration_role PASSWORD '<a real secret>';
-- and put the same value in .env's REGISTRATION_DB_PASSWORD (do not commit
-- the real secret anywhere). Then update docker-compose.yml's
-- registration-service block to use REGISTRATION_DB_USER/
-- REGISTRATION_DB_PASSWORD instead of the shared POSTGRES_USER/
-- POSTGRES_PASSWORD, and rebuild+restart registration-service.
--
-- Run: docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/037_registration_service_schema_isolation.sql

CREATE SCHEMA IF NOT EXISTS registration_svc;

ALTER TABLE IF EXISTS public.registration          SET SCHEMA registration_svc;
ALTER TABLE IF EXISTS public.registration_item      SET SCHEMA registration_svc;
ALTER TABLE IF EXISTS public.cart                   SET SCHEMA registration_svc;
ALTER TABLE IF EXISTS public.complimentary_ticket   SET SCHEMA registration_svc;
ALTER TABLE IF EXISTS public.payment                SET SCHEMA registration_svc;
ALTER TABLE IF EXISTS public.refund                 SET SCHEMA registration_svc;

-- Bring the live view definition in line with db/init/01_schema.sql's
-- schema-qualified version.
CREATE OR REPLACE VIEW v_event_finance AS
SELECT
    e.id                                                        AS event_id,
    e.title,
    e.status,
    COALESCE(SUM(DISTINCT r.total_amount), 0)                  AS ticket_revenue,
    COALESCE(
        (SELECT SUM(es2.amount) FROM payment_svc.event_sponsorship es2
         WHERE es2.event_id = e.id AND es2.status = 'received'), 0)
                                                                AS sponsorship_income,
    COALESCE(
        (SELECT SUM(ex2.amount) FROM payment_svc.event_expense ex2
         WHERE ex2.event_id = e.id), 0)                        AS total_expenses,
    COALESCE(
        (SELECT vrd.total_pool FROM payment_svc.vendor_revenue_distribution vrd
         WHERE vrd.event_id = e.id), 0)                        AS vendor_pool,
    COALESCE(
        (SELECT SUM(es3.amount) FROM payment_svc.event_sponsorship es3
         WHERE es3.event_id = e.id AND es3.status = 'received'), 0)
    + COALESCE(SUM(DISTINCT r.total_amount), 0)
    + COALESCE(
        (SELECT vrd2.total_pool FROM payment_svc.vendor_revenue_distribution vrd2
         WHERE vrd2.event_id = e.id), 0)
    - COALESCE(
        (SELECT SUM(ex3.amount) FROM payment_svc.event_expense ex3
         WHERE ex3.event_id = e.id), 0)                        AS net_balance,
    COALESCE(
        (SELECT COUNT(*) FROM payment_svc.event_sponsorship es4
         WHERE es4.event_id = e.id), 0)                        AS sponsor_count,
    COALESCE(
        (SELECT SUM(ct.ticket_count) FROM registration_svc.complimentary_ticket ct
         WHERE ct.event_id = e.id), 0)                         AS complimentary_tickets
FROM event_svc.event e
LEFT JOIN registration_svc.registration r ON r.event_id = e.id AND r.status = 'confirmed'
GROUP BY e.id, e.title, e.status
ORDER BY e.start_time;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'registration_role') THEN
    CREATE ROLE registration_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA registration_svc TO registration_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA registration_svc TO registration_role;
ALTER ROLE registration_role SET search_path = registration_svc, public;

-- registration-service's own code still reads/writes payment_svc.payment_transaction
-- (SELECT + UPDATE) and payment_svc.payment_audit_log (INSERT) directly for the
-- refund-request flow on cancellation.
GRANT USAGE ON SCHEMA payment_svc TO registration_role;
GRANT SELECT, UPDATE ON payment_svc.payment_transaction TO registration_role;
GRANT INSERT ON payment_svc.payment_audit_log TO registration_role;

-- event_role, ticket_role, user_role, and payment_role all already have
-- table-level grants into these 6 tables from their own isolation migrations
-- (033-036) — those persist automatically across the ALTER TABLE ... SET
-- SCHEMA above. But (same lesson as migration 036) table-level GRANT alone
-- isn't reachable without USAGE on registration_svc itself, which none of
-- them had until now.
GRANT USAGE ON SCHEMA registration_svc TO event_role;
GRANT USAGE ON SCHEMA registration_svc TO ticket_role;
GRANT USAGE ON SCHEMA registration_svc TO user_role;
GRANT USAGE ON SCHEMA registration_svc TO payment_role;
