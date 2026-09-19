-- Update database role passwords to match environment secrets.
-- These roles were created with a placeholder password 'ROTATE_ME_IMMEDIATELY'
-- in 01_schema.sql but need the actual secrets from .env/.env.test.
--
-- NOTE: This migration CANNOT use environment variables directly.
-- Instead, passwords must be updated via the application startup or a wrapper script.
-- For now, we create the idempotent structure; actual passwords are set via
-- docker-compose entrypoint or CI/CD after schema creation.
--
-- If roles don't exist, create them with a temporary password (will be changed).
-- If roles exist, they keep their current password (change manually if needed).

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_role') THEN
        CREATE ROLE user_role LOGIN PASSWORD 'temp_password_change_me';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'event_role') THEN
        CREATE ROLE event_role LOGIN PASSWORD 'temp_password_change_me';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ticket_role') THEN
        CREATE ROLE ticket_role LOGIN PASSWORD 'temp_password_change_me';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'payment_role') THEN
        CREATE ROLE payment_role LOGIN PASSWORD 'temp_password_change_me';
    END IF;

    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'registration_role') THEN
        CREATE ROLE registration_role LOGIN PASSWORD 'temp_password_change_me';
    END IF;
END $$;
