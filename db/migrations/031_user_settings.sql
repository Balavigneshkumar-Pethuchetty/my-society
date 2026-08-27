-- Per-user Settings feature: theme (cross-device sync, replaces localStorage-only
-- persistence), locale preference (stored only — no i18n/translation infra wired
-- up yet, see frontend Settings.tsx), and notification-channel opt-out toggles
-- (SMS / Email / Telegram), enforced in each service's send_channels()/
-- send_sms_telegram(). All three notify_* flags default TRUE so existing
-- users' notification behavior is unchanged until they explicitly opt out.
-- Run: docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/031_user_settings.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS theme            VARCHAR(10) NOT NULL DEFAULT 'system';
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale           VARCHAR(10) NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_sms       BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email     BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_telegram  BOOLEAN     NOT NULL DEFAULT TRUE;
