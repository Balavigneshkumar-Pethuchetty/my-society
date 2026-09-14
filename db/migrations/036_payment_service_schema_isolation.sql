-- Payment-service schema isolation (DB_ISOLATION_PLAN.md, step 4 of 5).
--
-- Moves the 13 tables exclusively owned by payment-service — sponsor,
-- event_sponsorship, sponsorship_refund, event_expense, vendor, event_vendor,
-- vendor_revenue_distribution, distribution_entry, committee_registry,
-- payment_transaction, payment_audit_log, payment_reconciliation_settings,
-- fund_export_link — out of the shared `public` schema into their own
-- `payment_svc` schema, and creates a dedicated `payment_role` that can only
-- read/write payment_svc (plus a few public tables it still needs directly).
--
-- Unlike the two-way-cross-write description in DB_ISOLATION_PLAN.md's
-- "Target service order" section, the actual fan-out turned out wider on the
-- *read* side: ticket-service's own ticket/roster query directly reads
-- `payment_transaction`/`payment_audit_log` for paid-at/refund-status, and
-- user-service's leave-request/account-deletion flow directly reads/deletes
-- `payment_transaction` and reads `committee_registry`/`sponsorship_refund`
-- for leave-blocker checks. Both of those services already had explicit
-- grants on these tables from their own isolation migrations (034, 035) —
-- Postgres grants persist across `ALTER TABLE ... SET SCHEMA`, so those
-- grants keep working unchanged after this move; no new GRANT is needed for
-- ticket_role/user_role here. What *did* need fixing: ticket-service's and
-- user-service's own SQL referenced these tables unqualified, which resolved
-- fine via `public` in their search_path before this move but stops
-- resolving once the tables leave `public` — schema-qualified in
-- `services/ticket/app/routes/tickets.py` and
-- `services/user/app/routes/leave_requests.py` (and registration-service's
-- `services/registration/app/routes/registrations.py`, which still runs as
-- the shared superuser but is equally affected by search_path resolution)
-- ahead of this migration.
--
-- Cross-schema FKs work exactly like same-schema ones in Postgres, and FK
-- enforcement (including ON DELETE CASCADE) runs with the constraint's own
-- privileges, not the invoking role's grants — so every existing FK into
-- these 13 tables (and from them into event_svc.event / user_svc.users /
-- registration) keeps working unchanged after the move. Re-verify this
-- empirically before relying on it (see DB_ISOLATION_PLAN.md's per-service
-- recipe step 3).
--
-- `v_event_finance` (a public-schema VIEW) reads three of these tables
-- (event_sponsorship, event_expense, vendor_revenue_distribution) — its
-- definition was updated in db/init/01_schema.sql to schema-qualify them,
-- but the *already-existing* view object in a live database was created
-- with the old unqualified body, so this migration also CREATE OR REPLACEs
-- it here to match. View SELECT privilege is checked via ownership chaining
-- (the caller only needs SELECT on the view itself, not on the underlying
-- tables) — so payment_role just needs GRANT SELECT on the view.
--
-- Idempotent: ALTER TABLE ... SET SCHEMA is guarded with IF EXISTS against
-- each public.<table> (a no-op once already moved), and the role
-- creation/grants are safe to re-run.
--
-- IMPORTANT — after applying, immediately rotate the placeholder password:
--   ALTER ROLE payment_role PASSWORD '<a real secret>';
-- and put the same value in .env's PAYMENT_DB_PASSWORD (do not commit the
-- real secret anywhere). Then update docker-compose.yml's payment-service
-- block to use PAYMENT_DB_USER/PAYMENT_DB_PASSWORD instead of the shared
-- POSTGRES_USER/POSTGRES_PASSWORD, and rebuild+restart payment-service
-- (docker compose build payment-service && docker compose up -d payment-service).
--
-- Known gap (documented, not fixed here — same precedent as event_role's
-- testing.py note): `services/payment/app/routes/testing.py`, gated behind
-- PAYMENT_SERVICE_ENV=testing and never mounted in production, also directly
-- INSERTs into `registration`/`payment`/`event` for local test seeding —
-- those specific test-only writes need a manual grant if that env var is
-- ever used locally against this isolated role.
--
-- Run: docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/036_payment_service_schema_isolation.sql

CREATE SCHEMA IF NOT EXISTS payment_svc;

ALTER TABLE IF EXISTS public.sponsor                          SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.event_sponsorship                SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.sponsorship_refund                SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.event_expense                     SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.vendor                             SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.event_vendor                       SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.vendor_revenue_distribution         SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.distribution_entry                 SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.committee_registry                  SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.payment_transaction                 SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.payment_audit_log                   SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.payment_reconciliation_settings      SET SCHEMA payment_svc;
ALTER TABLE IF EXISTS public.fund_export_link                    SET SCHEMA payment_svc;

-- Bring the live view definition in line with db/init/01_schema.sql's
-- schema-qualified version (a fresh install gets this from 01_schema.sql
-- directly; an already-running database needs it re-created here).
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
        (SELECT SUM(ct.ticket_count) FROM complimentary_ticket ct
         WHERE ct.event_id = e.id), 0)                         AS complimentary_tickets
FROM event_svc.event e
LEFT JOIN registration r ON r.event_id = e.id AND r.status = 'confirmed'
GROUP BY e.id, e.title, e.status
ORDER BY e.start_time;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'payment_role') THEN
    CREATE ROLE payment_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA payment_svc TO payment_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payment_svc TO payment_role;
ALTER ROLE payment_role SET search_path = payment_svc, public;

GRANT SELECT, UPDATE ON registration TO payment_role;
GRANT SELECT ON registration_item TO payment_role;
GRANT INSERT, DELETE ON notification TO payment_role;
GRANT SELECT ON v_event_finance TO payment_role;

-- ticket_role and user_role already have table-level SELECT/DELETE grants on
-- payment_transaction/payment_audit_log/committee_registry/sponsorship_refund
-- from their own isolation migrations (034, 035) — those persist across this
-- ALTER TABLE ... SET SCHEMA automatically. But table-level GRANT alone isn't
-- reachable without USAGE on payment_svc itself (unlike `public`, which every
-- role gets USAGE on by default), and payment_svc didn't exist when those
-- roles were created — so grant that missing piece now.
GRANT USAGE ON SCHEMA payment_svc TO ticket_role;
GRANT USAGE ON SCHEMA payment_svc TO user_role;
