-- Create core schema for shared foundational tables
-- Moves: oauth_session, currency, exchange_rate, notification
-- Keeps in public: society, schema_migrations (system tables)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'core') THEN
    CREATE SCHEMA core;
  END IF;
END $$;

-- Move oauth_session to core
ALTER TABLE IF EXISTS oauth_session SET SCHEMA core;

-- Move currency to core
ALTER TABLE IF EXISTS currency SET SCHEMA core;

-- Move exchange_rate to core (but it needs currency FK updated first)
ALTER TABLE IF EXISTS exchange_rate SET SCHEMA core;

-- Move notification to core
ALTER TABLE IF EXISTS notification SET SCHEMA core;

-- Update FKs: event.price_currency -> core.currency
ALTER TABLE event_svc.event
DROP CONSTRAINT IF EXISTS event_price_currency_fkey,
ADD CONSTRAINT event_price_currency_fkey
  FOREIGN KEY (price_currency) REFERENCES core.currency(code);

-- Update FKs: registration.display_currency -> core.currency
ALTER TABLE registration_svc.registration
DROP CONSTRAINT IF EXISTS registration_display_currency_fkey,
ADD CONSTRAINT registration_display_currency_fkey
  FOREIGN KEY (display_currency) REFERENCES core.currency(code);

-- Update FKs: payment.original_currency -> core.currency
ALTER TABLE registration_svc.payment
DROP CONSTRAINT IF EXISTS payment_original_currency_fkey,
ADD CONSTRAINT payment_original_currency_fkey
  FOREIGN KEY (original_currency) REFERENCES core.currency(code);

-- Update FKs: payment.settled_currency -> core.currency
ALTER TABLE registration_svc.payment
DROP CONSTRAINT IF EXISTS payment_settled_currency_fkey,
ADD CONSTRAINT payment_settled_currency_fkey
  FOREIGN KEY (settled_currency) REFERENCES core.currency(code);

-- Update FKs: payment.exchange_rate_id -> core.exchange_rate
ALTER TABLE registration_svc.payment
DROP CONSTRAINT IF EXISTS payment_exchange_rate_id_fkey,
ADD CONSTRAINT payment_exchange_rate_id_fkey
  FOREIGN KEY (exchange_rate_id) REFERENCES core.exchange_rate(id);

-- Update FKs: refund.original_currency -> core.currency
ALTER TABLE registration_svc.refund
DROP CONSTRAINT IF EXISTS refund_original_currency_fkey,
ADD CONSTRAINT refund_original_currency_fkey
  FOREIGN KEY (original_currency) REFERENCES core.currency(code);

-- Update FKs: refund.settled_currency -> core.currency
ALTER TABLE registration_svc.refund
DROP CONSTRAINT IF EXISTS refund_settled_currency_fkey,
ADD CONSTRAINT refund_settled_currency_fkey
  FOREIGN KEY (settled_currency) REFERENCES core.currency(code);

-- Update FKs: event_sponsorship.currency_code -> core.currency
ALTER TABLE payment_svc.event_sponsorship
DROP CONSTRAINT IF EXISTS event_sponsorship_currency_code_fkey,
ADD CONSTRAINT event_sponsorship_currency_code_fkey
  FOREIGN KEY (currency_code) REFERENCES core.currency(code);

-- Update FKs: sponsorship_refund.currency_code -> core.currency
ALTER TABLE payment_svc.sponsorship_refund
DROP CONSTRAINT IF EXISTS sponsorship_refund_currency_code_fkey,
ADD CONSTRAINT sponsorship_refund_currency_code_fkey
  FOREIGN KEY (currency_code) REFERENCES core.currency(code);

-- Update FKs: event_expense.currency_code -> core.currency
ALTER TABLE payment_svc.event_expense
DROP CONSTRAINT IF EXISTS event_expense_currency_code_fkey,
ADD CONSTRAINT event_expense_currency_code_fkey
  FOREIGN KEY (currency_code) REFERENCES core.currency(code);

-- Update FKs: vendor_revenue_distribution.currency_code -> core.currency
ALTER TABLE payment_svc.vendor_revenue_distribution
DROP CONSTRAINT IF EXISTS vendor_revenue_distribution_currency_code_fkey,
ADD CONSTRAINT vendor_revenue_distribution_currency_code_fkey
  FOREIGN KEY (currency_code) REFERENCES core.currency(code);

-- Recreate indexes in core schema
CREATE INDEX IF NOT EXISTS idx_session_user ON core.oauth_session(user_id);
CREATE INDEX IF NOT EXISTS idx_session_expires ON core.oauth_session(expires_at);
CREATE INDEX IF NOT EXISTS idx_exrate_lookup ON core.exchange_rate(from_currency, to_currency, valid_from DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON core.notification(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_notification_related_id ON core.notification(related_id);

-- Update search_path for all roles to include core schema (it will be checked after their own schema)
ALTER ROLE event_role SET search_path = event_svc, core, public;
ALTER ROLE ticket_role SET search_path = ticket_svc, core, public;
ALTER ROLE user_role SET search_path = user_svc, core, public;
ALTER ROLE payment_role SET search_path = payment_svc, core, public;
ALTER ROLE registration_role SET search_path = registration_svc, core, public;

-- Grant access to core schema for all roles
GRANT USAGE ON SCHEMA core TO event_role, ticket_role, user_role, payment_role, registration_role;
GRANT SELECT ON core.currency, core.exchange_rate TO event_role, ticket_role, payment_role, registration_role;
GRANT SELECT ON core.oauth_session TO ticket_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.notification TO event_role, user_role, payment_role;
GRANT SELECT ON core.notification TO ticket_role;
