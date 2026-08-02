-- Visitor Management Service — baseline schema.
--
-- This is a standalone database (own Postgres container, see docker-compose.yml's
-- visitor-postgres service) — NOT part of the main society_events database used
-- by every other service in this repo. There is no local `users` table here:
-- resident_user_id / security_id columns are plain UUIDs referencing user-service's
-- `users.id` in a different database entirely, resolved at write time over
-- user-service's internal API (see app/user_client.py) and cached on the row
-- (name/flat/phone) rather than joined live — see services/visitor's plan notes
-- for the rationale (ledger reads shouldn't depend on user-service's uptime, and
-- a ledger showing "what was true when the visitor came" is the more correct
-- audit record anyway).
--
-- Auto-runs via docker-entrypoint-initdb.d on the visitor-postgres container's
-- first volume init only (same caveat as db/init/01_schema.sql at the repo root —
-- editing this file has no effect on an already-initialized volume). Incremental
-- changes after launch go in db/migrations/0NN_*.sql, numbered/idempotent, same
-- convention as the rest of this repo.
--
-- Aadhaar verification is intentionally NOT a separate table here — see
-- visitor_pass.aadhaar below. Add an aadhaar_verification table via a numbered
-- migration only once real Aadhaar API integration is actually being built.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS visitor_pass (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_user_id     UUID        NOT NULL,
    resident_name        TEXT        NOT NULL,
    resident_flat        TEXT,
    resident_phone       TEXT,
    visitor_name         TEXT        NOT NULL,
    purpose              TEXT        NOT NULL,
    valid_from           TIMESTAMPTZ NOT NULL,
    valid_to             TIMESTAMPTZ NOT NULL,
    contact              TEXT,
    aadhaar              TEXT,   -- captured as provided; never validated/verified (future integration)
    email                TEXT,
    address              TEXT,
    qr_token             TEXT        UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    status               VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- Group pass support: one QR/pass can represent more than one person.
    -- visitor_count is the resident-stated expected headcount (default 1 —
    -- ordinary single-person passes are unaffected). entered_count/
    -- exited_count are running totals updated per gate scan, letting security
    -- admit/exit the group in batches across multiple scans of the same QR.
    -- additional_visitor_names is free-text (headcount tracking, not
    -- structured per-person records).
    visitor_count            INT  NOT NULL DEFAULT 1,
    additional_visitor_names TEXT,
    entered_count            INT  NOT NULL DEFAULT 0,
    exited_count             INT  NOT NULL DEFAULT 0,
    vehicle_number       TEXT,   -- optional; security can also set/correct this at the gate
    -- Cosmetic only — picks which themed background pass-image.png renders
    -- (see app/pass_image.py); nothing else behaves differently by category.
    visitor_category     VARCHAR(20) NOT NULL DEFAULT 'other',
    overdue_notified_at  TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT visitor_pass_status_check CHECK (status IN ('pending', 'partially_entered', 'entered', 'partially_exited', 'exited', 'cancelled', 'expired')),
    CONSTRAINT visitor_pass_valid_range  CHECK (valid_to > valid_from),
    CONSTRAINT visitor_pass_visitor_count_check CHECK (visitor_count >= 1),
    CONSTRAINT visitor_pass_visitor_category_check CHECK (visitor_category IN ('family', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_visitor_pass_resident         ON visitor_pass (resident_user_id);
CREATE INDEX IF NOT EXISTS idx_visitor_pass_qr_token         ON visitor_pass (qr_token);
CREATE INDEX IF NOT EXISTS idx_visitor_pass_status_valid_from ON visitor_pass (status, valid_from);

CREATE TABLE IF NOT EXISTS visitor_log (
    id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_pass_id      UUID        NOT NULL UNIQUE REFERENCES visitor_pass(id) ON DELETE CASCADE,
    entry_time           TIMESTAMPTZ NOT NULL,
    entry_security_id    UUID        NOT NULL,
    entry_security_name  TEXT,
    exit_time            TIMESTAMPTZ,
    exit_security_id     UUID,
    exit_security_name   TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitor_log_pass ON visitor_log (visitor_pass_id);

CREATE TABLE IF NOT EXISTS anonymous_visitor (
    id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    purpose                  TEXT        NOT NULL,
    visitor_name             TEXT,   -- optional — only purpose is mandatory for a quick walk-in log
    notes                    TEXT,
    contact                  TEXT,
    aadhaar                  TEXT,   -- captured as provided; never validated/verified (future integration)
    email                    TEXT,
    address                  TEXT,
    entry_time               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exit_time                TIMESTAMPTZ,
    entry_security_id        UUID        NOT NULL,
    entry_security_name      TEXT,
    exit_security_id         UUID,
    exit_security_name       TEXT,
    linked_resident_user_id  UUID,
    linked_resident_name     TEXT,
    linked_resident_flat     TEXT,
    linked_resident_phone    TEXT,
    vehicle_number           TEXT,   -- optional; security can also set/correct this after logging
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anon_visitor_entry_time       ON anonymous_visitor (entry_time);
CREATE INDEX IF NOT EXISTS idx_anon_visitor_linked_resident  ON anonymous_visitor (linked_resident_user_id);

CREATE TABLE IF NOT EXISTS visitor_photo (
    id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_pass_id       UUID        REFERENCES visitor_pass(id) ON DELETE CASCADE,
    anonymous_visitor_id  UUID        REFERENCES anonymous_visitor(id) ON DELETE CASCADE,
    security_id           UUID        NOT NULL,
    security_name         TEXT,
    file_path             TEXT        NOT NULL,
    captured_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT visitor_photo_one_owner CHECK (
        (visitor_pass_id IS NOT NULL AND anonymous_visitor_id IS NULL) OR
        (visitor_pass_id IS NULL AND anonymous_visitor_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_visitor_photo_pass ON visitor_photo (visitor_pass_id);
CREATE INDEX IF NOT EXISTS idx_visitor_photo_anon ON visitor_photo (anonymous_visitor_id);

CREATE TABLE IF NOT EXISTS phone_verification (
    id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    visitor_pass_id           UUID        NOT NULL REFERENCES visitor_pass(id) ON DELETE CASCADE,
    phone_number              TEXT        NOT NULL,
    otp_request_id            TEXT,
    verification_status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    requested_by_user_id      UUID        NOT NULL,
    verified_by_security_id   UUID,
    requested_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_at               TIMESTAMPTZ,
    CONSTRAINT phone_verification_status_check CHECK (verification_status IN ('pending', 'verified', 'failed', 'expired'))
);

CREATE INDEX IF NOT EXISTS idx_phone_verification_pass ON phone_verification (visitor_pass_id);

CREATE TABLE IF NOT EXISTS visitor_settings (
    id                          SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    overdue_threshold_minutes   INT         NOT NULL DEFAULT 60,
    daily_summary_enabled       BOOLEAN     NOT NULL DEFAULT TRUE,
    summary_interval            VARCHAR(10) NOT NULL DEFAULT 'daily',
    summary_hour_utc            INT         NOT NULL DEFAULT 3,
    last_summary_sent_at        TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT visitor_settings_interval_check CHECK (summary_interval IN ('daily', 'weekly'))
);

INSERT INTO visitor_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
