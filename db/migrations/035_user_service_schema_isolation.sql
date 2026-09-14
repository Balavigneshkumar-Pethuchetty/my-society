-- User-service schema isolation (DB_ISOLATION_PLAN.md, step 3 of 5).
--
-- Moves the tables exclusively owned by user-service — users, apartment,
-- user_apartments, admin_actions, leave_request, building_hierarchy_config,
-- structure_nodes, user_units, unit_assignment_requests, otp_login_sessions —
-- out of the shared `public` schema into their own `user_svc` schema, and
-- creates a dedicated `user_role` that can only read/write user_svc (plus a
-- few public tables its own code still touches directly — see below).
--
-- Unlike event-service/ticket-service, almost all of the *inbound* direction
-- (other services reading/writing `users`) was already fixed by the earlier
-- "Users API Isolation" work (2026-08-30, code-only at the time): registration/
-- ticket/payment/event-service already call user-service's `/internal/users/*`
-- API instead of querying `users` directly, and registration-service's guest-
-- account creation already goes through `POST /internal/users/guest`. Confirmed
-- by a fresh grep before this migration: zero live SQL against `users` (or the
-- apartment/unit/structure tables) anywhere outside services/user — only one
-- hit, in a fully commented-out/disabled route in payment-service. So no
-- rollback-window grant is needed for that direction either — this migration
-- is the DB-level finish of work that was already substantively done.
--
-- What's genuinely new here: the *outbound* direction — user-service's own
-- account-deletion/leave-request code (services/user/app/routes/
-- leave_requests.py) directly reads/deletes rows in registration-service's
-- and payment-service's tables (registration, payment, payment_transaction,
-- refund) and the shared `notification` inbox, plus reads committee_registry/
-- sponsorship_refund for leave-request blocker checks. Those services aren't
-- isolated yet (steps 4-5), so — same pattern ticket_role already uses for
-- registration/payment tables it still needs — user_role gets explicit grants
-- on those specific tables rather than an early internal-API build-out on
-- payment/registration-service.
--
-- Cross-schema FKs work exactly like same-schema ones in Postgres, and FK
-- enforcement (including ON DELETE CASCADE) runs with the constraint's own
-- privileges, not the invoking role's grants — so every existing FK into
-- `users` from other (still-public-schema) tables keeps working unchanged
-- after the move. Re-verify this empirically before relying on it (see
-- DB_ISOLATION_PLAN.md's per-service recipe step 3): delete a throwaway user
-- with a registration/ticket/notification attached and confirm the expected
-- cascade/SET NULL behavior still fires.
--
-- Idempotent: ALTER TABLE ... SET SCHEMA is guarded with IF EXISTS against
-- each public.<table> (a no-op once already moved), CREATE TABLE for
-- otp_login_sessions uses IF NOT EXISTS (it may already exist in `public`
-- from db/migrations/025_otp_login_sessions.sql — the ALTER TABLE SET SCHEMA
-- below moves it too), and the role creation/grants are safe to re-run.
--
-- IMPORTANT — after applying, immediately rotate the placeholder password:
--   ALTER ROLE user_role PASSWORD '<a real secret>';
-- and put the same value in .env's USER_DB_PASSWORD (do not commit the real
-- secret anywhere). Then update docker-compose.yml's user-service block to
-- use USER_DB_USER/USER_DB_PASSWORD instead of the shared POSTGRES_USER/
-- POSTGRES_PASSWORD, and `make restart-user-service`.
--
-- Run: docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/035_user_service_schema_isolation.sql

CREATE SCHEMA IF NOT EXISTS user_svc;

ALTER TABLE IF EXISTS public.apartment                 SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.users                      SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.user_apartments            SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.admin_actions              SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.leave_request              SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.building_hierarchy_config  SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.structure_nodes            SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.user_units                 SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.unit_assignment_requests   SET SCHEMA user_svc;
ALTER TABLE IF EXISTS public.otp_login_sessions         SET SCHEMA user_svc;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_role') THEN
    CREATE ROLE user_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA user_svc TO user_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA user_svc TO user_role;
ALTER ROLE user_role SET search_path = user_svc, public;

-- user-service's own code still reads/writes these public-schema tables
-- directly (leave-request activity export + account-deletion cleanup, and
-- the shared notification inbox).
GRANT SELECT, INSERT, UPDATE, DELETE ON notification TO user_role;
GRANT SELECT, DELETE ON registration, payment, payment_transaction, refund TO user_role;
GRANT SELECT ON committee_registry, sponsorship_refund TO user_role;

-- event_role no longer needs `users` (event-service's own code was already
-- converted to user-service's API before this migration — see above).
REVOKE SELECT ON user_svc.users FROM event_role;
