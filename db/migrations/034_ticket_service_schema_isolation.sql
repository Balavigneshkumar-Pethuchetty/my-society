-- Ticket-service schema isolation (DB_ISOLATION_PLAN.md, step 2 of 5).
--
-- Moves `ticket` — the one table ticket-service exclusively owns — out of the
-- shared `public` schema into its own `ticket_svc` schema, and creates a
-- dedicated `ticket_role` that can only read/write ticket_svc (plus the public
-- tables ticket-service's own code still touches directly: registration,
-- registration_item, payment, payment_audit_log, payment_transaction — none of
-- those services are isolated yet, so this is the same "explicit grant on a
-- not-yet-migrated table" pattern event_role already uses for users/
-- registration/notification, not a rollback-window grant).
--
-- registration-service (complimentary-ticket issue/cancel, registration-cancel)
-- and user-service (account-deletion activity export) were converted to call
-- ticket-service's new `/internal/tickets/*` endpoints instead of writing/
-- reading `ticket` directly, so no rollback-window grant to the shared role is
-- needed for those two call directions — cutting off direct access is the
-- actual point.
--
-- Cross-schema FKs work exactly like same-schema ones in Postgres, and FK
-- enforcement (including ON DELETE CASCADE) runs with the constraint's own
-- privileges, not the invoking role's grants — so the existing
-- registration(id)/users(id)/event_svc.event(id) FKs into `ticket` keep
-- working unchanged after the move. Re-verify this empirically before relying
-- on it (see DB_ISOLATION_PLAN.md's per-service recipe step 3): delete a
-- throwaway registration/event with a ticket attached and confirm no orphaned
-- ticket row remains.
--
-- Idempotent: ALTER TABLE ... SET SCHEMA is guarded with IF EXISTS against
-- public.ticket (a no-op once the table has already moved), and the role
-- creation/grants are safe to re-run.
--
-- IMPORTANT — after applying, immediately rotate the placeholder password:
--   ALTER ROLE ticket_role PASSWORD '<a real secret>';
-- and put the same value in .env's TICKET_DB_PASSWORD (do not commit the real
-- secret anywhere). Then update docker-compose.yml's ticket-service block to
-- use TICKET_DB_USER/TICKET_DB_PASSWORD instead of the shared POSTGRES_USER/
-- POSTGRES_PASSWORD, and `make restart-ticket-service` (or the manual
-- build+up for services without a dedicated make target).
--
-- Run: docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/034_ticket_service_schema_isolation.sql

CREATE SCHEMA IF NOT EXISTS ticket_svc;

ALTER TABLE IF EXISTS public.ticket SET SCHEMA ticket_svc;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ticket_role') THEN
    CREATE ROLE ticket_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA ticket_svc TO ticket_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ticket_svc TO ticket_role;
ALTER ROLE ticket_role SET search_path = ticket_svc, public;

-- ticket-service's own code still reads/writes these public-schema tables
-- directly (registration+payment JOINs in the ticket/roster query, the
-- gate-scan endpoints flipping registration.status to 'attended').
GRANT SELECT, UPDATE ON registration TO ticket_role;
GRANT SELECT ON registration_item, payment, payment_audit_log, payment_transaction TO ticket_role;
