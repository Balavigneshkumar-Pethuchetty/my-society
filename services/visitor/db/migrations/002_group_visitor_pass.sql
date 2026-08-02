-- Group visitor passes: one QR pass can now represent more than one person
-- (e.g. a family or a work crew). visitor_count is the resident-stated
-- expected headcount; entered_count/exited_count are running totals updated
-- by each gate scan (security can admit a partial group and scan the same
-- QR again later for the rest — see services/visitor's group-pass notes).
-- additional_visitor_names is free-text, not a structured per-person list —
-- this is headcount tracking, not per-person identity/photos.
--
-- Status gains two new values for partial group movement: 'partially_entered'
-- (some but not all of the group have arrived) and 'partially_exited' (some
-- but not all who arrived have left). The status CHECK constraint is dropped
-- and re-added since Postgres has no ALTER CONSTRAINT for changing a CHECK's
-- condition in place.
--
-- Run: docker exec -i society_visitor_postgres psql -U <user> -d visitor_service < services/visitor/db/migrations/002_group_visitor_pass.sql

ALTER TABLE visitor_pass ADD COLUMN IF NOT EXISTS visitor_count INT NOT NULL DEFAULT 1;
ALTER TABLE visitor_pass ADD COLUMN IF NOT EXISTS additional_visitor_names TEXT;
ALTER TABLE visitor_pass ADD COLUMN IF NOT EXISTS entered_count INT NOT NULL DEFAULT 0;
ALTER TABLE visitor_pass ADD COLUMN IF NOT EXISTS exited_count INT NOT NULL DEFAULT 0;

DO $$ BEGIN
    ALTER TABLE visitor_pass ADD CONSTRAINT visitor_pass_visitor_count_check CHECK (visitor_count >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill entered_count/exited_count for any passes created before this
-- migration, from their existing visitor_log row, so in-flight passes don't
-- suddenly look like nobody has arrived.
UPDATE visitor_pass vp
SET entered_count = CASE WHEN vl.entry_time IS NOT NULL THEN 1 ELSE 0 END,
    exited_count  = CASE WHEN vl.exit_time  IS NOT NULL THEN 1 ELSE 0 END
FROM visitor_log vl
WHERE vl.visitor_pass_id = vp.id
  AND vp.entered_count = 0
  AND vp.exited_count = 0;

ALTER TABLE visitor_pass DROP CONSTRAINT IF EXISTS visitor_pass_status_check;
ALTER TABLE visitor_pass ADD CONSTRAINT visitor_pass_status_check
    CHECK (status IN ('pending', 'partially_entered', 'entered', 'partially_exited', 'exited', 'cancelled', 'expired'));
