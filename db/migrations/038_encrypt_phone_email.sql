-- Application-level encryption at rest for users.phone/users.email — see
-- PII_PRIVACY_PLAN.md. Schema-only: widens both columns to TEXT (AES-256-GCM
-- ciphertext, base64-encoded, is longer than the raw value), adds a blind-index
-- hash column for each (deterministic HMAC-SHA256 — lookups query the hash
-- column instead of sending plaintext into a WHERE clause), and moves the
-- UNIQUE constraints from the plaintext columns to the hash columns (since
-- AES-GCM's random nonce makes ciphertext for the same phone number differ
-- row to row — a UNIQUE constraint on the ciphertext column would silently
-- stop enforcing real uniqueness once encrypted).
--
-- Encrypting the *existing data* and populating the hash columns is an
-- application-level operation (needs the key, which lives outside Postgres)
-- — that's a separate one-off script:
--   docker compose run --rm user-service python -m app.scripts.backfill_pii_encryption
--
-- IMPORTANT — deployment order (no dual-read/dual-write mode; keep it simple
-- since this is a small, single-operator dataset, not a live zero-downtime
-- migration):
--   1. Set PII_ENCRYPTION_KEY / PII_HASH_KEY in .env (see .env.example).
--   2. Apply this migration.
--   3. Stop user-service (old code still expects plaintext phone/email).
--   4. Run the backfill script above — encrypts every existing row in place.
--   5. Deploy/restart user-service with the updated code (expects ciphertext
--      + hash columns only, no plaintext fallback).
-- Running the updated app code against un-backfilled data (or vice versa)
-- will break every phone/email lookup — don't split steps 3-5 across a
-- window where old and new code both handle live traffic.
--
-- Run: docker exec -i society_postgres psql -U <user> -d society_events < db/migrations/038_encrypt_phone_email.sql

ALTER TABLE users ALTER COLUMN phone TYPE TEXT;
ALTER TABLE users ALTER COLUMN email TYPE TEXT;

ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_hash TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_unique;
DROP INDEX IF EXISTS idx_users_email_unique;
-- idx_users_phone / idx_users_email (plain, non-unique — used to exist for
-- general lookups) are now pointless once these columns hold ciphertext;
-- dropped rather than left around as dead weight.
DROP INDEX IF EXISTS idx_users_phone;
DROP INDEX IF EXISTS idx_users_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_hash_unique ON users(phone_hash) WHERE phone_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash_unique ON users(email_hash) WHERE email_hash IS NOT NULL;
-- Non-unique indexes for the equality lookups the app now performs against
-- the hash columns (login, forgot-password, internal by-email resolution).
CREATE INDEX IF NOT EXISTS idx_users_phone_hash ON users(phone_hash) WHERE phone_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash) WHERE email_hash IS NOT NULL;

-- admin_actions.target_user_email is a denormalized audit-log snapshot of
-- users.email at action time — becomes a copy of the same ciphertext (no
-- separate encrypt step needed in application code, see notes in
-- PII_PRIVACY_PLAN.md). Widen to match, and allow NULL since encrypting a
-- phone-only user's absent email now yields NULL rather than an empty string.
ALTER TABLE admin_actions ALTER COLUMN target_user_email TYPE TEXT;
ALTER TABLE admin_actions ALTER COLUMN target_user_email DROP NOT NULL;

-- leave_request.user_email is the same kind of denormalized snapshot
-- (services/user/app/routes/leave_requests.py's create_leave_request already
-- copies users.email as-is — was plaintext, becomes ciphertext for free).
ALTER TABLE leave_request ALTER COLUMN user_email TYPE TEXT;

-- otp_login_sessions.phone is already TEXT — no type change needed, only
-- application code changes (encrypt before INSERT; not looked up by value,
-- so no hash column required here). Existing rows hold plaintext written
-- before this migration; the column is write-only (never read back by any
-- query) and short-lived (24h TTL), so rather than add plaintext-vs-
-- ciphertext detection for a column nothing ever reads, just clear it —
-- any resident with a live phone-login session simply logs in again.
DELETE FROM otp_login_sessions;
