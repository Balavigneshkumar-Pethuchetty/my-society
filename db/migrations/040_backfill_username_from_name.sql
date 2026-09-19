-- Migration 040: Backfill username from name column (for testing alias feature)
-- Status: For testing only - copies name column as username for directory/communication feature
-- Idempotent: uses DO $$ ... $$ with already-checked conditions

DO $$
BEGIN
    -- Check if there are any NULL usernames to backfill
    IF EXISTS (SELECT 1 FROM user_svc.users WHERE username IS NULL LIMIT 1) THEN
        UPDATE user_svc.users
        SET username = name
        WHERE username IS NULL
            AND name IS NOT NULL;
        RAISE NOTICE 'Backfilled % users with username from name column',
            (SELECT COUNT(*) FROM user_svc.users WHERE username IS NOT NULL);
    ELSE
        RAISE NOTICE 'No NULL usernames found, backfill skipped';
    END IF;
END $$;

-- Record this migration as applied
INSERT INTO event_svc.schema_migrations (filename, applied_at)
VALUES ('040_backfill_username_from_name.sql', NOW())
ON CONFLICT (filename) DO NOTHING;
