-- =============================================================================
-- Society Events — Database Schema
-- PostgreSQL 16 | Runs automatically on first container start
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- trigram search on event titles

-- ---------------------------------------------------------------------------
-- SOCIETY  (top-level tenant; supports multi-society SaaS later)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS society (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    address         TEXT        NOT NULL,
    city            VARCHAR(100) NOT NULL,
    contact_email   VARCHAR(255) NOT NULL,
    base_currency   CHAR(3)     NOT NULL DEFAULT 'INR',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- USERS, APARTMENT, USER_APARTMENTS, ADMIN_ACTIONS, LEAVE_REQUEST,
-- BUILDING_HIERARCHY_CONFIG, STRUCTURE_NODES, USER_UNITS,
-- UNIT_ASSIGNMENT_REQUESTS, OTP_LOGIN_SESSIONS all live in their own
-- `user_svc` schema (see DB_ISOLATION_PLAN.md — step 3, user-service schema
-- isolation) — a separate Postgres role (user_role) can read/write only this
-- schema, enforcing that no other service can touch these tables directly
-- anymore (see the GRANT block at the end of this file). Every other table
-- that references `users` now does so via a schema-qualified
-- `user_svc.users(id)` FK — cross-schema FKs work the same as same-schema
-- ones in Postgres, this just makes the ownership boundary explicit in the
-- DDL (same convention `event_svc` already established in step 1).
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS user_svc;

-- ---------------------------------------------------------------------------
-- APARTMENT  (a flat / villa inside a society)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.apartment (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id  UUID        NOT NULL REFERENCES society(id) ON DELETE CASCADE,
    block       VARCHAR(10) NOT NULL,
    unit_number VARCHAR(20) NOT NULL,
    type        VARCHAR(50) NOT NULL,         -- '1BHK' | '2BHK' | '3BHK' | 'Villa'
    UNIQUE (society_id, block, unit_number)
);

-- ---------------------------------------------------------------------------
-- USERS  ('user' is reserved in SQL; table is 'users')
-- keycloak_sub = the immutable 'sub' claim from every Keycloak JWT.
-- password_hash is intentionally absent — Keycloak owns credentials.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.users (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(255) UNIQUE,                -- set for phone-registered accounts
    name                VARCHAR(255) NOT NULL,
    email               VARCHAR(255),                       -- nullable for phone-only accounts
    phone               VARCHAR(20)  UNIQUE,                -- E.164 format: +91XXXXXXXXXX
    role                VARCHAR(50) NOT NULL DEFAULT 'resident',
                        -- 'admin' | 'committee_member' | 'resident' | 'security_guard' | 'sponsor'
    keycloak_sub        VARCHAR(255) UNIQUE,  -- Keycloak user UUID (sub claim)
    identity_provider   VARCHAR(50) NOT NULL DEFAULT 'keycloak',
                        -- 'keycloak' | 'google' | 'facebook' | 'apple'
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index on email (NULL is allowed, uniqueness enforced only when set)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON user_svc.users(email) WHERE email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- USER_APARTMENTS  (many-to-many: a resident can own / be linked to multiple flats)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.user_apartments (
    user_id       UUID        NOT NULL REFERENCES user_svc.users(id) ON DELETE CASCADE,
    apartment_id  UUID        NOT NULL REFERENCES user_svc.apartment(id) ON DELETE CASCADE,
    added_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, apartment_id)
);

CREATE INDEX IF NOT EXISTS idx_user_apartments_user ON user_svc.user_apartments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_apartments_apt  ON user_svc.user_apartments(apartment_id);

-- ---------------------------------------------------------------------------
-- ADMIN_ACTIONS  (persistent audit log of every admin user-management action)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.admin_actions (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id            UUID        REFERENCES user_svc.users(id) ON DELETE SET NULL,
    admin_name          VARCHAR(255) NOT NULL,
    target_user_id      UUID        REFERENCES user_svc.users(id) ON DELETE SET NULL,
    target_user_name    VARCHAR(255) NOT NULL,
    target_user_email   VARCHAR(255) NOT NULL,
    action              VARCHAR(20) NOT NULL
                        CHECK (action IN ('approved','rejected','removed','revoked','role_changed')),
    role                VARCHAR(50),
    performed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_actions_admin_id     ON user_svc.admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_performed_at ON user_svc.admin_actions(performed_at DESC);

-- ---------------------------------------------------------------------------
-- OAUTH_SESSION  (optional — tracks active refresh tokens per device)
-- Enables "log out all devices" and refresh-token reuse detection.
-- You can skip this and rely solely on Keycloak's session management.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oauth_session (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        NOT NULL REFERENCES user_svc.users(id) ON DELETE CASCADE,
    access_token_jti    VARCHAR(255) NOT NULL UNIQUE,  -- JWT 'jti' claim
    refresh_token_hash  VARCHAR(255),                  -- SHA-256 of the refresh token
    device_info         TEXT,
    ip_address          INET,
    expires_at          TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- CURRENCY  (ISO 4217 lookup; seed with INR + common NRI currencies)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS currency (
    code        CHAR(3)     PRIMARY KEY,        -- 'INR', 'USD', 'GBP', …
    name        VARCHAR(100) NOT NULL,
    symbol      VARCHAR(10) NOT NULL,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    is_base     BOOLEAN     NOT NULL DEFAULT FALSE   -- exactly one row = TRUE (INR)
);

-- ---------------------------------------------------------------------------
-- EXCHANGE_RATE  (historical; one row per rate snapshot)
-- Both original and settled amounts on PAYMENT reference the rate locked
-- at payment time — critical for accounting accuracy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchange_rate (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency   CHAR(3)     NOT NULL REFERENCES currency(code),
    to_currency     CHAR(3)     NOT NULL REFERENCES currency(code),
    rate            NUMERIC(18,8) NOT NULL,
    source          VARCHAR(100) NOT NULL DEFAULT 'manual',   -- 'RBI'|'openexchangerates'|'manual'
    valid_from      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_to        TIMESTAMPTZ,                              -- NULL = currently active
    CONSTRAINT chk_diff_currency CHECK (from_currency <> to_currency)
);

-- ---------------------------------------------------------------------------
-- EVENT_CATEGORY, EVENT, TICKET_TYPE, ANNOUNCEMENT, EVENT_PERMISSION all live in
-- their own `event_svc` schema (see DB_ISOLATION_PLAN.md — step 1, event-service
-- schema isolation) — a separate Postgres role (event_role) can read/write only
-- this schema, enforcing that no other service can touch these tables directly
-- anymore (see the GRANT block at the end of this file). Every other table that
-- references one of these five now does so via a schema-qualified
-- `event_svc.<table>(id)` FK — cross-schema FKs work the same as same-schema
-- ones in Postgres, this just makes the ownership boundary explicit in the DDL.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS event_svc;

-- ---------------------------------------------------------------------------
-- EVENT_CATEGORY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_svc.event_category (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id  UUID        NOT NULL REFERENCES society(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    icon        VARCHAR(100),
    color_hex   CHAR(7)
);

-- ---------------------------------------------------------------------------
-- EVENT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_svc.event (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id      UUID        NOT NULL REFERENCES society(id) ON DELETE CASCADE,
    category_id     UUID        REFERENCES event_svc.event_category(id) ON DELETE SET NULL,
    organizer_id    UUID        NOT NULL REFERENCES user_svc.users(id),
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    venue           VARCHAR(255) NOT NULL,
    capacity        INTEGER,
    status          VARCHAR(50) NOT NULL DEFAULT 'draft',
                    -- 'draft' | 'published' | 'cancelled' | 'completed'
    ticket_price    NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    price_currency  CHAR(3)     NOT NULL DEFAULT 'INR' REFERENCES currency(code),
    is_free         BOOLEAN     NOT NULL DEFAULT TRUE,
    venue_lat       DOUBLE PRECISION,
    venue_lng       DOUBLE PRECISION,
    venue_place_id  TEXT,
    venue_address   TEXT,
    cancel_freeze_at TIMESTAMPTZ,
                    -- last moment a resident may self-cancel a confirmed ticket; NULL = disabled
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_end_after_start CHECK (end_time > start_time),
    CONSTRAINT chk_price_positive  CHECK (ticket_price >= 0)
);

-- ---------------------------------------------------------------------------
-- REGISTRATION, REGISTRATION_ITEM, CART, COMPLIMENTARY_TICKET, PAYMENT,
-- REFUND all live in their own `registration_svc` schema (see
-- DB_ISOLATION_PLAN.md — step 5, registration-service schema isolation,
-- the last of the 5) — a separate Postgres role (registration_role) can
-- read/write only this schema plus a few public tables it still needs
-- directly (see the GRANT block at the end of this file), same convention
-- `event_svc`/`ticket_svc`/`user_svc`/`payment_svc` already established.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS registration_svc;

-- ---------------------------------------------------------------------------
-- REGISTRATION  (one per user per event; ticket_count covers family members)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration_svc.registration (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id         UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES user_svc.users(id),
    ticket_count     INTEGER     NOT NULL DEFAULT 1 CHECK (ticket_count > 0),
    total_amount     NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    display_currency CHAR(3)     NOT NULL DEFAULT 'INR' REFERENCES currency(code),
    status           VARCHAR(50) NOT NULL DEFAULT 'pending',
                     -- 'pending' | 'confirmed' | 'cancelled' | 'attended'
    qr_code          TEXT,                              -- base64 QR or short token
    registered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No UNIQUE (event_id, user_id): a resident may hold multiple
    -- registrations for the same event (e.g. buying a ticket for a guest).
);

-- ---------------------------------------------------------------------------
-- CART  (one active checkout basket per user; added by
-- db/migrations/007_cart.sql — added here too per CLAUDE.md's two-layer rule,
-- was missing from this file)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration_svc.cart (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES user_svc.users(id)  ON DELETE CASCADE,
    event_id    UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    event_title TEXT        NOT NULL,
    event_venue TEXT        NOT NULL,
    event_start TIMESTAMPTZ NOT NULL,
    currency    VARCHAR(10) NOT NULL DEFAULT 'INR',
    tickets     JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT cart_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_user_id  ON registration_svc.cart (user_id);
CREATE INDEX IF NOT EXISTS idx_cart_event_id ON registration_svc.cart (event_id);

-- ---------------------------------------------------------------------------
-- TICKET lives in its own `ticket_svc` schema (see DB_ISOLATION_PLAN.md — step
-- 2, ticket-service schema isolation) — a separate Postgres role (ticket_role)
-- can read/write only this schema plus a few public tables it still needs
-- directly (see the GRANT block at the end of this file). Every other
-- service's write into `ticket` now goes through ticket-service's
-- `/internal/tickets/*` API instead of a direct INSERT/UPDATE.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ticket_svc;

CREATE TABLE IF NOT EXISTS ticket_svc.ticket (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    reg_id      UUID        NOT NULL REFERENCES registration_svc.registration(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES user_svc.users(id)        ON DELETE CASCADE,
    event_id    UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    qr_token    TEXT        UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status      VARCHAR(20) NOT NULL DEFAULT 'active',
    scanned_at  TIMESTAMPTZ,
    scanned_by  UUID REFERENCES user_svc.users(id),
    CONSTRAINT ticket_reg_unique   UNIQUE (reg_id),
    CONSTRAINT ticket_status_check CHECK  (status IN ('active', 'used', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_user_id  ON ticket_svc.ticket (user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_event_id ON ticket_svc.ticket (event_id);
CREATE INDEX IF NOT EXISTS idx_ticket_qr_token ON ticket_svc.ticket (qr_token);

-- ---------------------------------------------------------------------------
-- PAYMENT  (two-amount design: original (user-facing) + settled (INR))
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration_svc.payment (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id     UUID        NOT NULL REFERENCES registration_svc.registration(id),
    gateway_name        VARCHAR(100) NOT NULL,          -- 'razorpay' | 'cashfree' | 'stripe'
    gateway_order_id    VARCHAR(255),
    gateway_txn_id      VARCHAR(255) UNIQUE,
    original_amount     NUMERIC(10,2) NOT NULL,         -- amount shown to user
    original_currency   CHAR(3)     NOT NULL REFERENCES currency(code),
    settled_amount      NUMERIC(10,2) NOT NULL,         -- amount credited to bank (INR)
    settled_currency    CHAR(3)     NOT NULL DEFAULT 'INR' REFERENCES currency(code),
    exchange_rate_used  NUMERIC(18,8) NOT NULL DEFAULT 1.0,
    exchange_rate_id    UUID        REFERENCES exchange_rate(id),
    status              VARCHAR(50) NOT NULL DEFAULT 'pending',
                        -- 'pending' | 'success' | 'failed' | 'refunded'
    gateway_response    JSONB,                          -- full webhook payload
    paid_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- REFUND  (mirrors the two-amount pattern from PAYMENT)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration_svc.refund (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id              UUID        NOT NULL REFERENCES registration_svc.payment(id),
    initiated_by            UUID        NOT NULL REFERENCES user_svc.users(id),
    original_refund_amount  NUMERIC(10,2) NOT NULL,
    original_currency       CHAR(3)     NOT NULL REFERENCES currency(code),
    settled_refund_amount   NUMERIC(10,2) NOT NULL,
    settled_currency        CHAR(3)     NOT NULL DEFAULT 'INR' REFERENCES currency(code),
    reason                  TEXT,
    status                  VARCHAR(50) NOT NULL DEFAULT 'pending',
                            -- 'pending' | 'processed' | 'failed'
    gateway_refund_id       VARCHAR(255),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENT  (broadcast message to all registrants of an event)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_svc.announcement (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    author_id   UUID        NOT NULL REFERENCES user_svc.users(id),
    title       VARCHAR(255) NOT NULL,
    body        TEXT        NOT NULL,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- NOTIFICATION  (per-user inbox; drives the bell icon in the UI)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES user_svc.users(id) ON DELETE CASCADE,
    event_id    UUID        REFERENCES event_svc.event(id) ON DELETE SET NULL,
    type        VARCHAR(100) NOT NULL,
                -- 'registration_confirmed' | 'payment_success' | 'event_reminder'
                -- 'event_cancelled' | 'refund_processed' | 'announcement'
    title       VARCHAR(255) NOT NULL,
    message     TEXT        NOT NULL,
    is_read     BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    related_id  UUID        -- generic entity ref (not a FK: points at different
                             -- tables depending on `type`), used to delete a
                             -- "pending action" notification once resolved
);

CREATE INDEX IF NOT EXISTS idx_notification_related_id ON notification(related_id);

-- ---------------------------------------------------------------------------
-- LEAVE_REQUEST  (self-service "leave society": resident requests -> admin
-- approves/rejects/revokes -> resident finalizes irreversible deletion).
-- user_name/user_email are snapshotted so this row stays a readable audit
-- record after the users row itself is deleted (user_id/reviewed_by -> NULL).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.leave_request (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        REFERENCES user_svc.users(id) ON DELETE SET NULL,
    user_name         VARCHAR(255) NOT NULL,
    user_email        VARCHAR(255),
    reason            TEXT,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected','revoked','completed')),
    requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by       UUID        REFERENCES user_svc.users(id) ON DELETE SET NULL,
    reviewed_by_name  VARCHAR(255),
    reviewed_at       TIMESTAMPTZ,
    review_note       TEXT,
    completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_leave_request_user_id ON user_svc.leave_request(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_request_status   ON user_svc.leave_request(status);

-- Only one open (pending/approved) request per user at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_request_one_open
    ON user_svc.leave_request(user_id) WHERE status IN ('pending','approved');

-- ---------------------------------------------------------------------------
-- OTP_LOGIN_SESSIONS  (added by db/migrations/025_otp_login_sessions.sql;
-- added here too per CLAUDE.md's two-layer rule — was missing from this file)
-- Bridge sessions for phone-OTP login. keycloak_sub is plain TEXT (not a FK),
-- so this table has no cross-schema dependency at all.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.otp_login_sessions (
    session_token_hash TEXT PRIMARY KEY,
    keycloak_sub        TEXT NOT NULL,
    phone                TEXT NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at           TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_otp_login_sessions_expires_at ON user_svc.otp_login_sessions (expires_at);

-- =============================================================================
-- INDEXES  (add before seed so they're built once, not rebuilt per INSERT)
-- =============================================================================

-- users
CREATE INDEX IF NOT EXISTS idx_users_keycloak_sub  ON user_svc.users(keycloak_sub);
CREATE INDEX IF NOT EXISTS idx_users_email         ON user_svc.users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone         ON user_svc.users(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_username      ON user_svc.users(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_role          ON user_svc.users(role);

-- apartment
CREATE INDEX IF NOT EXISTS idx_apartment_society    ON user_svc.apartment(society_id);

-- event
CREATE INDEX IF NOT EXISTS idx_event_society        ON event_svc.event(society_id);
CREATE INDEX IF NOT EXISTS idx_event_status         ON event_svc.event(status);
CREATE INDEX IF NOT EXISTS idx_event_start_time     ON event_svc.event(start_time);
CREATE INDEX IF NOT EXISTS idx_event_title_trgm     ON event_svc.event USING gin(title gin_trgm_ops);

-- registration
CREATE INDEX IF NOT EXISTS idx_reg_event            ON registration_svc.registration(event_id);
CREATE INDEX IF NOT EXISTS idx_reg_user             ON registration_svc.registration(user_id);
CREATE INDEX IF NOT EXISTS idx_reg_status           ON registration_svc.registration(status);

-- payment
CREATE INDEX IF NOT EXISTS idx_pay_registration     ON registration_svc.payment(registration_id);
CREATE INDEX IF NOT EXISTS idx_pay_status           ON registration_svc.payment(status);
CREATE INDEX IF NOT EXISTS idx_pay_gateway_txn      ON registration_svc.payment(gateway_txn_id);

-- notification
CREATE INDEX IF NOT EXISTS idx_notif_user_unread    ON notification(user_id, is_read)
    WHERE is_read = FALSE;

-- exchange_rate
CREATE INDEX IF NOT EXISTS idx_exrate_lookup        ON exchange_rate(from_currency, to_currency, valid_from DESC);

-- oauth_session
CREATE INDEX IF NOT EXISTS idx_session_user         ON oauth_session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_expires      ON oauth_session(expires_at);

-- =============================================================================
-- SPONSOR, EVENT_SPONSORSHIP, SPONSORSHIP_REFUND, EVENT_EXPENSE, VENDOR,
-- EVENT_VENDOR, VENDOR_REVENUE_DISTRIBUTION, DISTRIBUTION_ENTRY,
-- COMMITTEE_REGISTRY, PAYMENT_TRANSACTION, PAYMENT_AUDIT_LOG,
-- PAYMENT_RECONCILIATION_SETTINGS, FUND_EXPORT_LINK all live in their own
-- `payment_svc` schema (see DB_ISOLATION_PLAN.md — step 4, payment-service
-- schema isolation) — a separate Postgres role (payment_role) can read/write
-- only this schema plus a few public tables it still needs directly (see the
-- GRANT block at the end of this file), same convention `event_svc`/
-- `ticket_svc`/`user_svc` already established.
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS payment_svc;

-- =============================================================================
-- SPONSOR  (organizations or individuals who sponsor events)
-- user_id links to a users row when the sponsor also has a platform account.
-- =============================================================================
CREATE TABLE IF NOT EXISTS payment_svc.sponsor (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID        REFERENCES user_svc.users(id) ON DELETE SET NULL,
    organization_name   VARCHAR(255) NOT NULL,
    organization_type   VARCHAR(50)  NOT NULL DEFAULT 'private',
                        -- 'public' | 'private' | 'ngo' | 'individual'
    contact_name        VARCHAR(255),
    contact_email       VARCHAR(255),
    contact_phone       VARCHAR(20),
    logo_url            TEXT,
    is_active           BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- EVENT_SPONSORSHIP  (one sponsor ↔ one event per row; multiple sponsors OK)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_svc.event_sponsorship (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    sponsor_id          UUID        NOT NULL REFERENCES payment_svc.sponsor(id) ON DELETE CASCADE,
    amount              NUMERIC(12,2) NOT NULL,
    currency_code       CHAR(3)     NOT NULL DEFAULT 'INR' REFERENCES currency(code),
    status              VARCHAR(50) NOT NULL DEFAULT 'pledged',
                        -- 'pledged' | 'received' | 'refund_requested' | 'refunded'
    payment_reference   VARCHAR(255),
    notes               TEXT,
    sponsored_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sponsorship_amount CHECK (amount > 0),
    UNIQUE (event_id, sponsor_id)
);

-- ---------------------------------------------------------------------------
-- SPONSORSHIP_REFUND  (sponsor raises request; organizer/admin approves)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_svc.sponsorship_refund (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    sponsorship_id      UUID        NOT NULL REFERENCES payment_svc.event_sponsorship(id) ON DELETE CASCADE,
    requested_by        UUID        NOT NULL REFERENCES user_svc.users(id),
    amount              NUMERIC(12,2) NOT NULL,
    currency_code       CHAR(3)     NOT NULL DEFAULT 'INR' REFERENCES currency(code),
    reason              TEXT,
    status              VARCHAR(50) NOT NULL DEFAULT 'pending',
                        -- 'pending' | 'approved' | 'rejected' | 'processed'
    reviewed_by         UUID        REFERENCES user_svc.users(id),
    reviewed_at         TIMESTAMPTZ,
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_refund_amount CHECK (amount > 0)
);

-- ---------------------------------------------------------------------------
-- EVENT_EXPENSE  (cost items logged by organizer; drives the finance view)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_svc.event_expense (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    description     VARCHAR(255) NOT NULL,
    amount          NUMERIC(10,2) NOT NULL,
    currency_code   CHAR(3)     NOT NULL DEFAULT 'INR' REFERENCES currency(code),
    category        VARCHAR(50) NOT NULL DEFAULT 'other',
                    -- 'venue' | 'catering' | 'equipment' | 'marketing' | 'staff' | 'other'
    receipt_url     TEXT,
    created_by      UUID        NOT NULL REFERENCES user_svc.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_expense_amount CHECK (amount > 0)
);

-- ---------------------------------------------------------------------------
-- COMPLIMENTARY_TICKET  (free-entry allocation managed by organizer)
-- invited_by_user_id is NULL for walk_in entries — no account required.
-- Named entries (organizer/committee_member/sponsor) get a real registration
-- + ticket (registration_id/guest_user_id set, scannable QR); walk_in entries
-- stay a headcount-only log (registration_id/guest_user_id/guest_name NULL).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration_svc.complimentary_ticket (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    invited_by_user_id  UUID        REFERENCES user_svc.users(id) ON DELETE SET NULL,
    inviter_type        VARCHAR(50) NOT NULL,
                        -- 'organizer' | 'committee_member' | 'sponsor' | 'walk_in'
    registration_id     UUID        REFERENCES registration_svc.registration(id) ON DELETE CASCADE,
    guest_user_id       UUID        REFERENCES user_svc.users(id),
    guest_name          VARCHAR(255),
    guest_email         VARCHAR(255),
    ticket_count        INTEGER     NOT NULL DEFAULT 1,
    notes               TEXT,
    created_by          UUID        NOT NULL REFERENCES user_svc.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at        TIMESTAMPTZ,
    emailed_at          TIMESTAMPTZ,
    CONSTRAINT chk_comp_ticket_count CHECK (ticket_count > 0),
    CONSTRAINT complimentary_ticket_reg_unique UNIQUE (registration_id)
);

-- =============================================================================
-- INDEXES — new tables
-- =============================================================================

-- sponsor
CREATE INDEX IF NOT EXISTS idx_sponsor_user         ON payment_svc.sponsor(user_id);
CREATE INDEX IF NOT EXISTS idx_sponsor_active       ON payment_svc.sponsor(is_active);

-- event_sponsorship
CREATE INDEX IF NOT EXISTS idx_esponsor_event       ON payment_svc.event_sponsorship(event_id);
CREATE INDEX IF NOT EXISTS idx_esponsor_sponsor     ON payment_svc.event_sponsorship(sponsor_id);
CREATE INDEX IF NOT EXISTS idx_esponsor_status      ON payment_svc.event_sponsorship(status);

-- sponsorship_refund
CREATE INDEX IF NOT EXISTS idx_srefund_sponsorship  ON payment_svc.sponsorship_refund(sponsorship_id);
CREATE INDEX IF NOT EXISTS idx_srefund_status       ON payment_svc.sponsorship_refund(status);

-- event_expense
CREATE INDEX IF NOT EXISTS idx_expense_event        ON payment_svc.event_expense(event_id);
CREATE INDEX IF NOT EXISTS idx_expense_category     ON payment_svc.event_expense(category);

-- complimentary_ticket
CREATE INDEX IF NOT EXISTS idx_compticket_event     ON registration_svc.complimentary_ticket(event_id);
CREATE INDEX IF NOT EXISTS idx_compticket_inviter   ON registration_svc.complimentary_ticket(invited_by_user_id);

-- =============================================================================
-- VENDOR  (shops / stalls invited to an event)
-- =============================================================================
CREATE TABLE IF NOT EXISTS payment_svc.vendor (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    society_id      UUID        NOT NULL REFERENCES society(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    category        VARCHAR(50) NOT NULL DEFAULT 'other',
                    -- 'food' | 'beverages' | 'merchandise' | 'games' | 'services' | 'other'
    contact_name    VARCHAR(255),
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(20),
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- EVENT_VENDOR  (link a vendor to a specific event; includes fee arrangement)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_svc.event_vendor (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id            UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    vendor_id           UUID        NOT NULL REFERENCES payment_svc.vendor(id) ON DELETE CASCADE,
    stall_number        VARCHAR(20),
    fee_type            VARCHAR(50) NOT NULL DEFAULT 'fixed',
                        -- 'fixed' | 'revenue_share' | 'free'
    fixed_fee           NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    revenue_share_pct   NUMERIC(5,2) NOT NULL DEFAULT 0.00,
                        -- percentage of vendor's gross revenue paid to the society
    actual_revenue      NUMERIC(12,2),   -- filled in after event completes
    status              VARCHAR(50) NOT NULL DEFAULT 'invited',
                        -- 'invited' | 'confirmed' | 'cancelled'
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ev_fixed_fee      CHECK (fixed_fee >= 0),
    CONSTRAINT chk_ev_share_pct      CHECK (revenue_share_pct >= 0 AND revenue_share_pct <= 100),
    UNIQUE (event_id, vendor_id)
);

-- ---------------------------------------------------------------------------
-- VENDOR_REVENUE_DISTRIBUTION  (pool collected from vendors for an event)
-- Once organizer approves, individual distribution_entry rows are created.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_svc.vendor_revenue_distribution (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id        UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    total_pool      NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    currency_code   CHAR(3)     NOT NULL DEFAULT 'INR' REFERENCES currency(code),
    status          VARCHAR(50) NOT NULL DEFAULT 'draft',
                    -- 'draft' | 'approved' | 'distributed'
    approved_by     UUID        REFERENCES user_svc.users(id),
    approved_at     TIMESTAMPTZ,
    distributed_at  TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_vrd_pool CHECK (total_pool >= 0),
    UNIQUE (event_id)
);

-- ---------------------------------------------------------------------------
-- DISTRIBUTION_ENTRY  (individual payout line inside a revenue distribution)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_svc.distribution_entry (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    distribution_id     UUID        NOT NULL REFERENCES payment_svc.vendor_revenue_distribution(id) ON DELETE CASCADE,
    recipient_type      VARCHAR(50) NOT NULL,
                        -- 'sponsor' | 'organizer' | 'resident' | 'society'
    recipient_user_id   UUID        REFERENCES user_svc.users(id) ON DELETE SET NULL,
    recipient_sponsor_id UUID       REFERENCES payment_svc.sponsor(id) ON DELETE SET NULL,
    share_percentage    NUMERIC(5,2) NOT NULL,
    amount              NUMERIC(12,2) NOT NULL,
    status              VARCHAR(50) NOT NULL DEFAULT 'pending',
                        -- 'pending' | 'paid'
    paid_at             TIMESTAMPTZ,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_de_pct    CHECK (share_percentage > 0 AND share_percentage <= 100),
    CONSTRAINT chk_de_amount CHECK (amount >= 0)
);

-- =============================================================================
-- TICKET_TYPE  (named tiers per event: e.g. Breakfast, Lunch, Games Pass)
-- An event with no ticket_type rows falls back to the single-price legacy flow.
-- =============================================================================
CREATE TABLE IF NOT EXISTS event_svc.ticket_type (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,   -- 'General Entry', 'Dinner', 'Games Pass', …
    description TEXT,
    price       NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    is_free     BOOLEAN     NOT NULL DEFAULT FALSE,
    capacity    INTEGER,                 -- NULL = unlimited
    sort_order  INTEGER     NOT NULL DEFAULT 0,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_tt_price CHECK (price >= 0),
    UNIQUE (event_id, name)
);

-- ---------------------------------------------------------------------------
-- REGISTRATION_ITEM  (line item within a registration for multi-type tickets)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registration_svc.registration_item (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID        NOT NULL REFERENCES registration_svc.registration(id) ON DELETE CASCADE,
    ticket_type_id  UUID        NOT NULL REFERENCES event_svc.ticket_type(id),
    quantity        INTEGER     NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price      NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    total_price     NUMERIC(10,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ri_price CHECK (unit_price >= 0),
    UNIQUE (registration_id, ticket_type_id)
);

-- =============================================================================
-- INDEXES — vendor + ticket tables
-- =============================================================================

-- vendor
CREATE INDEX IF NOT EXISTS idx_vendor_society       ON payment_svc.vendor(society_id);
CREATE INDEX IF NOT EXISTS idx_vendor_category      ON payment_svc.vendor(category);

-- event_vendor
CREATE INDEX IF NOT EXISTS idx_evendor_event        ON payment_svc.event_vendor(event_id);
CREATE INDEX IF NOT EXISTS idx_evendor_vendor       ON payment_svc.event_vendor(vendor_id);
CREATE INDEX IF NOT EXISTS idx_evendor_status       ON payment_svc.event_vendor(status);

-- vendor_revenue_distribution
CREATE INDEX IF NOT EXISTS idx_vrd_event            ON payment_svc.vendor_revenue_distribution(event_id);
CREATE INDEX IF NOT EXISTS idx_vrd_status           ON payment_svc.vendor_revenue_distribution(status);

-- distribution_entry
CREATE INDEX IF NOT EXISTS idx_distentry_dist       ON payment_svc.distribution_entry(distribution_id);
CREATE INDEX IF NOT EXISTS idx_distentry_user       ON payment_svc.distribution_entry(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_distentry_sponsor    ON payment_svc.distribution_entry(recipient_sponsor_id);

-- ticket_type
CREATE INDEX IF NOT EXISTS idx_ticktype_event       ON event_svc.ticket_type(event_id);
CREATE INDEX IF NOT EXISTS idx_ticktype_sort        ON event_svc.ticket_type(event_id, sort_order);

-- registration_item
CREATE INDEX IF NOT EXISTS idx_regitem_registration ON registration_svc.registration_item(registration_id);
CREATE INDEX IF NOT EXISTS idx_regitem_ticktype     ON registration_svc.registration_item(ticket_type_id);

-- =============================================================================
-- FINANCE SUMMARY VIEW  (per-event income, expenses, and complimentary count)
-- Now includes vendor revenue in net_balance calculation.
-- =============================================================================
CREATE OR REPLACE VIEW v_event_finance AS
SELECT
    e.id                                                        AS event_id,
    e.title,
    e.status,
    COALESCE(SUM(DISTINCT r.total_amount), 0)                  AS ticket_revenue,
    COALESCE(
        (SELECT SUM(es2.amount) FROM payment_svc.event_sponsorship es2
         WHERE es2.event_id = e.id AND es2.status = 'received'), 0)
                                                                AS sponsorship_income,
    COALESCE(
        (SELECT SUM(ex2.amount) FROM payment_svc.event_expense ex2
         WHERE ex2.event_id = e.id), 0)                        AS total_expenses,
    COALESCE(
        (SELECT vrd.total_pool FROM payment_svc.vendor_revenue_distribution vrd
         WHERE vrd.event_id = e.id), 0)                        AS vendor_pool,
    COALESCE(
        (SELECT SUM(es3.amount) FROM payment_svc.event_sponsorship es3
         WHERE es3.event_id = e.id AND es3.status = 'received'), 0)
    + COALESCE(SUM(DISTINCT r.total_amount), 0)
    + COALESCE(
        (SELECT vrd2.total_pool FROM payment_svc.vendor_revenue_distribution vrd2
         WHERE vrd2.event_id = e.id), 0)
    - COALESCE(
        (SELECT SUM(ex3.amount) FROM payment_svc.event_expense ex3
         WHERE ex3.event_id = e.id), 0)                        AS net_balance,
    COALESCE(
        (SELECT COUNT(*) FROM payment_svc.event_sponsorship es4
         WHERE es4.event_id = e.id), 0)                        AS sponsor_count,
    COALESCE(
        (SELECT SUM(ct.ticket_count) FROM registration_svc.complimentary_ticket ct
         WHERE ct.event_id = e.id), 0)                         AS complimentary_tickets
FROM event_svc.event e
LEFT JOIN registration_svc.registration r ON r.event_id = e.id AND r.status = 'confirmed'
GROUP BY e.id, e.title, e.status
ORDER BY e.start_time;

-- =============================================================================
-- BUILDING HIERARCHY CONFIG  (flexible society/building structure level names)
-- Level 1 is the top (e.g. Tower), deepest level is typically the billable unit.
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_svc.building_hierarchy_config (
    id          SERIAL      PRIMARY KEY,
    level_index INTEGER     NOT NULL UNIQUE CHECK (level_index >= 1),
    level_name  VARCHAR(50) NOT NULL,
    is_billable BOOLEAN     NOT NULL DEFAULT FALSE
);

-- ---------------------------------------------------------------------------
-- STRUCTURE NODES  (recursive tree; any node can be Tower A, Wing B, Flat 101)
-- Deleting a parent cascades to all descendants.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.structure_nodes (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    level_index INTEGER     NOT NULL REFERENCES user_svc.building_hierarchy_config(level_index) ON DELETE CASCADE,
    parent_id   UUID        REFERENCES user_svc.structure_nodes(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_structure_nodes_parent ON user_svc.structure_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_structure_nodes_level  ON user_svc.structure_nodes(level_index);

-- Link each user to a specific unit (the billable-level node they reside in)
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS structure_node_id UUID REFERENCES user_svc.structure_nodes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_structure_node ON user_svc.users(structure_node_id) WHERE structure_node_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- USER_UNITS  (many-to-many: one user can hold multiple flats; multiple users
-- can share one flat — co-owners, family members, tenants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.user_units (
    user_id   UUID        NOT NULL REFERENCES user_svc.users(id) ON DELETE CASCADE,
    node_id   UUID        NOT NULL REFERENCES user_svc.structure_nodes(id) ON DELETE CASCADE,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_user_units_user ON user_svc.user_units(user_id);
CREATE INDEX IF NOT EXISTS idx_user_units_node ON user_svc.user_units(node_id);

-- ---------------------------------------------------------------------------
-- UNIT_ASSIGNMENT_REQUESTS  (non-privileged users request to add or remove a
-- flat; admin / committee_member approves or rejects)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_svc.unit_assignment_requests (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES user_svc.users(id) ON DELETE CASCADE,
    node_id     UUID        NOT NULL REFERENCES user_svc.structure_nodes(id) ON DELETE CASCADE,
    notes       TEXT,
    type        VARCHAR(10) NOT NULL DEFAULT 'add'
                CHECK (type IN ('add', 'remove')),
    status      VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by UUID        REFERENCES user_svc.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_unit_requests_user   ON user_svc.unit_assignment_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_unit_requests_node   ON user_svc.unit_assignment_requests(node_id);
CREATE INDEX IF NOT EXISTS idx_unit_requests_status ON user_svc.unit_assignment_requests(status);

-- ---------------------------------------------------------------------------
-- COMMITTEE_REGISTRY / PAYMENT_TRANSACTION / PAYMENT_AUDIT_LOG
-- (see db/migrations/009_payment_reconciliation.sql, 028_event_reconciliation_config.sql)
-- ---------------------------------------------------------------------------

-- One collector (committee member + UPI ID) per event, plus that event's own
-- IMAP mailbox for auto-reconciliation (imap_password is Fernet-encrypted).
CREATE TABLE IF NOT EXISTS payment_svc.committee_registry (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID         NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    member_id   UUID         NOT NULL REFERENCES user_svc.users(id),
    upi_id      VARCHAR(100) NOT NULL,
    assigned_by UUID         REFERENCES user_svc.users(id),
    assigned_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
    imap_host     VARCHAR(255) NOT NULL DEFAULT '',
    imap_port     INT          NOT NULL DEFAULT 993,
    imap_user     VARCHAR(255) NOT NULL DEFAULT '',
    imap_password TEXT         NOT NULL DEFAULT '',
    imap_mailbox  VARCHAR(100) NOT NULL DEFAULT 'INBOX',
    CONSTRAINT committee_registry_event_unique UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS idx_committee_registry_event_id  ON payment_svc.committee_registry (event_id);
CREATE INDEX IF NOT EXISTS idx_committee_registry_member_id ON payment_svc.committee_registry (member_id);

-- Payment transaction: one per resident payment attempt
-- Status lifecycle: pending → verified → refund_requested → refunded
CREATE TABLE IF NOT EXISTS payment_svc.payment_transaction (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    txn_ref          VARCHAR(24)   NOT NULL,
    event_id         UUID          NOT NULL REFERENCES event_svc.event(id),
    registration_id  UUID          REFERENCES registration_svc.registration(id) ON DELETE SET NULL,
    user_id          UUID          NOT NULL REFERENCES user_svc.users(id),
    amount           NUMERIC(12,2) NOT NULL,
    currency         VARCHAR(10)   NOT NULL DEFAULT 'INR',
    payee_upi        VARCHAR(100),
    payer_upi        VARCHAR(100),
    status           VARCHAR(30)   NOT NULL DEFAULT 'pending',
    payment_utr      VARCHAR(100),
    refund_utr       VARCHAR(100),
    parsed_amount     NUMERIC(10,2),
    parsed_upi_ref    VARCHAR(100),
    parsed_rrn        VARCHAR(100),
    parsed_bank       VARCHAR(100),
    parsed_timestamp  VARCHAR(100),
    idempotency_key  VARCHAR(200)  NOT NULL,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT payment_txn_ref_unique     UNIQUE (txn_ref),
    CONSTRAINT payment_idempotency_unique UNIQUE (idempotency_key),
    CONSTRAINT payment_status_check       CHECK (status IN (
        'pending', 'verified', 'refund_requested', 'refunded', 'cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS idx_payment_txn_event_id        ON payment_svc.payment_transaction (event_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_user_id         ON payment_svc.payment_transaction (user_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_registration_id ON payment_svc.payment_transaction (registration_id);
CREATE INDEX IF NOT EXISTS idx_payment_txn_status          ON payment_svc.payment_transaction (status);
CREATE INDEX IF NOT EXISTS idx_payment_txn_payment_utr     ON payment_svc.payment_transaction (payment_utr);

-- Audit log: append-only state-transition trail
CREATE TABLE IF NOT EXISTS payment_svc.payment_audit_log (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    txn_id      UUID         NOT NULL REFERENCES payment_svc.payment_transaction(id) ON DELETE CASCADE,
    from_status VARCHAR(30),
    to_status   VARCHAR(30)  NOT NULL,
    updated_by  VARCHAR(200) NOT NULL,  -- 'system_auto' or user UUID string
    note        TEXT,
    at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit_txn_id ON payment_svc.payment_audit_log (txn_id);
CREATE INDEX IF NOT EXISTS idx_payment_audit_at     ON payment_svc.payment_audit_log (at DESC);

-- ── Payment reconciliation settings (single-row, deployment-wide scan cadence +
--    AI-parser infra config — per-event IMAP mailbox lives on committee_registry,
--    see db/migrations/028_event_reconciliation_config.sql) ─────────────────────
CREATE TABLE IF NOT EXISTS payment_svc.payment_reconciliation_settings (
    id               SMALLINT PRIMARY KEY DEFAULT 1,
    poll_interval_s  INT          NOT NULL DEFAULT 300,
    use_ai_parser    BOOLEAN      NOT NULL DEFAULT FALSE,
    ai_provider      VARCHAR(20)  NOT NULL DEFAULT 'ollama',
    ollama_host      VARCHAR(255) NOT NULL DEFAULT 'http://localhost:11434',
    ollama_model     VARCHAR(100) NOT NULL DEFAULT 'llama3',
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT single_settings_row CHECK (id = 1),
    CONSTRAINT ai_provider_check CHECK (ai_provider IN ('ollama', 'claude'))
);
INSERT INTO payment_svc.payment_reconciliation_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- EVENT_PERMISSION  (per-event delegation: organizer grants another user
-- access to this specific event only — see db/migrations/019_event_permission.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS event_svc.event_permission (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id     UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES user_svc.users(id) ON DELETE CASCADE,
    granted_by   UUID        NOT NULL REFERENCES user_svc.users(id),
    granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at   TIMESTAMPTZ,
    UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_permission_event ON event_svc.event_permission(event_id);
CREATE INDEX IF NOT EXISTS idx_event_permission_user  ON event_svc.event_permission(user_id);

-- ---------------------------------------------------------------------------
-- FUND_EXPORT_LINK  (shareable, unauthenticated download link for a fund
-- export — see db/migrations/020_fund_export_link.sql)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_svc.fund_export_link (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    UUID        NOT NULL REFERENCES event_svc.event(id) ON DELETE CASCADE,
    token       VARCHAR(64) NOT NULL UNIQUE,
    created_by  UUID        NOT NULL REFERENCES user_svc.users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fund_export_link_event ON payment_svc.fund_export_link(event_id);
CREATE INDEX IF NOT EXISTS idx_fund_export_link_token  ON payment_svc.fund_export_link(token);

-- ---------------------------------------------------------------------------
-- USERS.avatar_url  (uploaded profile picture, stored server-side by
-- user-service — see db/migrations/023_user_avatar.sql)
-- ---------------------------------------------------------------------------
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);

-- ---------------------------------------------------------------------------
-- USERS.email_verified / phone_verified  (see db/migrations/024_user_verification.sql)
-- ---------------------------------------------------------------------------
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- USERS.theme / locale / notify_sms / notify_email / notify_telegram
-- (see db/migrations/031_user_settings.sql)
-- ---------------------------------------------------------------------------
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS theme            VARCHAR(10) NOT NULL DEFAULT 'system';
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS locale           VARCHAR(10) NOT NULL DEFAULT 'en';
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS notify_sms       BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS notify_email     BOOLEAN     NOT NULL DEFAULT TRUE;
ALTER TABLE user_svc.users ADD COLUMN IF NOT EXISTS notify_telegram  BOOLEAN     NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- SCHEMA_MIGRATIONS  (bookkeeping for db/migrations/*.sql — see
-- db/migrations/032_add_migration_tracking.sql and `make migrate` / `make migrate-status`)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename    TEXT        PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- EVENT_ROLE  (see db/migrations/033_event_service_schema_isolation.sql and
-- DB_ISOLATION_PLAN.md) — event-service connects as this role instead of the
-- shared default role, and can only read/write the event_svc schema plus the
-- few public tables its own code still touches directly (registration,
-- notification). IMPORTANT: the password below is a placeholder — rotate it
-- immediately after a fresh install with:
--   ALTER ROLE event_role PASSWORD '<a real secret>';
-- and put the same value in .env's EVENT_DB_PASSWORD. Never commit a real
-- secret into this file.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'event_role') THEN
    CREATE ROLE event_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA event_svc TO event_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA event_svc TO event_role;
ALTER ROLE event_role SET search_path = event_svc, public;

-- `users` grant removed (step 3, DB_ISOLATION_PLAN.md): event-service's own
-- code no longer touches `users` directly (converted to user-service's API
-- during the "Users API Isolation" work), and it's now in user_svc anyway.
-- `registration` moved to registration_svc in step 5 — USAGE grant is new as
-- of migration 037 (table-level GRANT alone isn't reachable without it).
GRANT USAGE ON SCHEMA registration_svc TO event_role;
GRANT SELECT ON registration_svc.registration TO event_role;
GRANT SELECT, INSERT ON notification TO event_role;

-- ---------------------------------------------------------------------------
-- TICKET_ROLE  (see db/migrations/034_ticket_service_schema_isolation.sql and
-- DB_ISOLATION_PLAN.md) — ticket-service connects as this role instead of the
-- shared default role, and can only read/write the ticket_svc schema plus the
-- few public tables its own code still touches directly (registration +
-- registration_item for the ticket/roster queries, payment/payment_audit_log/
-- payment_transaction for paid-at/refund-status lookups, and flipping
-- registration.status to 'attended' on gate scan). IMPORTANT: the password
-- below is a placeholder — rotate it immediately after a fresh install with:
--   ALTER ROLE ticket_role PASSWORD '<a real secret>';
-- and put the same value in .env's TICKET_DB_PASSWORD. Never commit a real
-- secret into this file.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ticket_role') THEN
    CREATE ROLE ticket_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA ticket_svc TO ticket_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ticket_svc TO ticket_role;
ALTER ROLE ticket_role SET search_path = ticket_svc, public;

-- Table-level GRANT alone isn't reachable without USAGE on the table's schema
-- too (unlike `public`, which every role gets USAGE on by default) — payment_svc
-- didn't exist yet when ticket_role was first created (migration 034), so this
-- USAGE grant is new as of migration 036, and registration_svc's is new as of 037.
GRANT USAGE ON SCHEMA payment_svc TO ticket_role;
GRANT SELECT ON payment_svc.payment_audit_log, payment_svc.payment_transaction TO ticket_role;
GRANT USAGE ON SCHEMA registration_svc TO ticket_role;
GRANT SELECT, UPDATE ON registration_svc.registration TO ticket_role;
GRANT SELECT ON registration_svc.registration_item, registration_svc.payment TO ticket_role;

-- ---------------------------------------------------------------------------
-- USER_ROLE  (see db/migrations/035_user_service_schema_isolation.sql and
-- DB_ISOLATION_PLAN.md) — user-service connects as this role instead of the
-- shared default role, and can only read/write the user_svc schema plus the
-- few public tables its own code still touches directly: `notification`
-- (shared inbox table, no single owner — same as event_role's grant),
-- `registration`/`payment`/`payment_transaction`/`refund` (leave-request
-- account-deletion cleanup + activity export), and `committee_registry`/
-- `sponsorship_refund` (leave-request blocker checks). IMPORTANT: the
-- password below is a placeholder — rotate it immediately after a fresh
-- install with:
--   ALTER ROLE user_role PASSWORD '<a real secret>';
-- and put the same value in .env's USER_DB_PASSWORD. Never commit a real
-- secret into this file.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_role') THEN
    CREATE ROLE user_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA user_svc TO user_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA user_svc TO user_role;
ALTER ROLE user_role SET search_path = user_svc, public;

GRANT SELECT, INSERT, UPDATE, DELETE ON notification TO user_role;
-- Same USAGE requirement as ticket_role above — new as of migration 036 (payment_svc)
-- and 037 (registration_svc).
GRANT USAGE ON SCHEMA payment_svc TO user_role;
GRANT SELECT, DELETE ON payment_svc.payment_transaction TO user_role;
GRANT SELECT ON payment_svc.committee_registry, payment_svc.sponsorship_refund TO user_role;
GRANT USAGE ON SCHEMA registration_svc TO user_role;
GRANT SELECT, DELETE ON registration_svc.registration, registration_svc.payment, registration_svc.refund TO user_role;

-- ---------------------------------------------------------------------------
-- PAYMENT_ROLE  (see db/migrations/036_payment_service_schema_isolation.sql
-- and DB_ISOLATION_PLAN.md) — payment-service connects as this role instead
-- of the shared default role, and can only read/write the payment_svc schema
-- plus a few public tables its own code still touches directly:
-- `registration`/`registration_item` (confirm-on-verify + amount/ticket-type
-- lookups) and `notification` (payment-status alerts — INSERT/DELETE only,
-- never reads it). IMPORTANT: the password below is a placeholder — rotate
-- it immediately after a fresh install with:
--   ALTER ROLE payment_role PASSWORD '<a real secret>';
-- and put the same value in .env's PAYMENT_DB_PASSWORD. Never commit a real
-- secret into this file.
--
-- Known gap (documented, not fixed here — same precedent as event_role's
-- testing.py note): `services/payment/app/routes/testing.py`, gated behind
-- PAYMENT_SERVICE_ENV=testing and never mounted in production, also directly
-- INSERTs into `registration`/`payment`/`event` for local test seeding — those
-- specific test-only writes need a manual grant if that env var is ever used
-- locally against this isolated role.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'payment_role') THEN
    CREATE ROLE payment_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA payment_svc TO payment_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA payment_svc TO payment_role;
ALTER ROLE payment_role SET search_path = payment_svc, public;

-- USAGE grant on registration_svc is new as of migration 037.
GRANT USAGE ON SCHEMA registration_svc TO payment_role;
GRANT SELECT, UPDATE ON registration_svc.registration TO payment_role;
GRANT SELECT ON registration_svc.registration_item TO payment_role;
GRANT INSERT, DELETE ON notification TO payment_role;
GRANT SELECT ON v_event_finance TO payment_role;

-- ---------------------------------------------------------------------------
-- REGISTRATION_ROLE  (see db/migrations/037_registration_service_schema_isolation.sql
-- and DB_ISOLATION_PLAN.md) — registration-service connects as this role
-- instead of the shared default role, and can only read/write the
-- registration_svc schema plus payment_svc.payment_transaction/
-- payment_audit_log (refund-request-on-cancel flow — the one remaining
-- direct cross-schema write this service makes; every other cross-service
-- call already goes through an internal API). IMPORTANT: the password below
-- is a placeholder — rotate it immediately after a fresh install with:
--   ALTER ROLE registration_role PASSWORD '<a real secret>';
-- and put the same value in .env's REGISTRATION_DB_PASSWORD. Never commit a
-- real secret into this file. This is the last of the 5 services in
-- DB_ISOLATION_PLAN.md — once this ships, every backend service connects as
-- its own dedicated, non-superuser role.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'registration_role') THEN
    CREATE ROLE registration_role LOGIN PASSWORD 'ROTATE_ME_IMMEDIATELY';
  END IF;
END $$;

GRANT USAGE ON SCHEMA registration_svc TO registration_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA registration_svc TO registration_role;
ALTER ROLE registration_role SET search_path = registration_svc, public;

GRANT USAGE ON SCHEMA payment_svc TO registration_role;
GRANT SELECT, UPDATE ON payment_svc.payment_transaction TO registration_role;
GRANT INSERT ON payment_svc.payment_audit_log TO registration_role;
