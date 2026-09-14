-- Migration bookkeeping (see MAINTAINABILITY_PLAN.md step 4).
--
-- Until now db/migrations/*.sql were applied by hand with nothing recording which
-- files ran where, so an environment silently missing a migration another has was
-- invisible until something broke. This table is that record: `make migrate` writes
-- one row per file it applies (and skips files already recorded), and
-- `make migrate-status` diffs the directory against it to show what is still pending.
--
-- The first `make migrate` after this lands re-applies every migration once (they are
-- all independently idempotent, so this is a no-op) and backfills a row for each.
-- After that, only genuinely new files run.
--
-- Idempotent. Purely additive — touches no existing table.
-- Run: docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/032_add_migration_tracking.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT        PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
