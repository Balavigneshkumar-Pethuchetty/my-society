-- Event-service schema isolation (DB_ISOLATION_PLAN.md, step 1 of 5).
--
-- Moves the five tables exclusively written by event-service — event,
-- event_category, ticket_type, announcement, event_permission — out of the
-- shared `public` schema into their own `event_svc` schema, and creates a
-- dedicated `event_role` that can only read/write event_svc (plus the few
-- public tables event-service's own code still touches directly: users,
-- registration, notification). Every other service was already converted
-- (registration/ticket/payment/user) to call event-service's new
-- `/internal/events/*` and `/internal/ticket-types` endpoints instead of
-- JOINing into these tables directly, so no rollback-window grant to the
-- shared role is needed here — cutting off direct access is the actual point.
--
-- Cross-schema FKs work exactly like same-schema ones in Postgres, and FK
-- enforcement (including ON DELETE CASCADE) runs with the constraint's own
-- privileges, not the invoking role's grants — so every existing FK into
-- these five tables from other (still-public-schema) tables keeps working
-- unchanged after the move. Re-verify this empirically before relying on it
-- (see DB_ISOLATION_PLAN.md's per-service recipe step 3): delete a throwaway
-- event with a registration/ticket/payment_transaction attached and confirm
-- no orphaned rows remain.
--
-- Idempotent: ALTER TABLE ... SET SCHEMA is guarded with IF EXISTS against
-- public.<table> (a no-op once the table has already moved), and the role
-- creation/grants are safe to re-run.
--
-- IMPORTANT — after applying, immediately rotate the placeholder password:
--   ALTER ROLE event_role PASSWORD '<a real secret>';
-- and put the same value in .env's EVENT_DB_PASSWORD (do not commit the real
-- secret anywhere). Then update docker-compose.yml's event-service block to
-- use EVENT_DB_USER/EVENT_DB_PASSWORD instead of the shared POSTGRES_USER/
-- POSTGRES_PASSWORD, and `make restart-event-service`.
--
-- Run: docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/033_event_service_schema_isolation.sql

CREATE SCHEMA IF NOT EXISTS event_svc;

ALTER TABLE IF EXISTS public.event            SET SCHEMA event_svc;
ALTER TABLE IF EXISTS public.event_category   SET SCHEMA event_svc;
ALTER TABLE IF EXISTS public.ticket_type      SET SCHEMA event_svc;
ALTER TABLE IF EXISTS public.announcement     SET SCHEMA event_svc;
ALTER TABLE IF EXISTS public.event_permission SET SCHEMA event_svc;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'event_role') THEN
    CREATE ROLE event_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA event_svc TO event_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA event_svc TO event_role;
ALTER ROLE event_role SET search_path = event_svc, public;

-- event-service's own code still reads/writes these public-schema tables
-- directly (organizer/author/permission-grantee lookups against users;
-- capacity checks against registration; writing its own notifications).
GRANT SELECT ON users, registration TO event_role;
GRANT SELECT, INSERT ON notification TO event_role;
