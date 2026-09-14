-- Minimal reference data every service's pytest suite relies on existing (the hardcoded
-- SOCIETY_ID constant + the 'INR' currency FK target) — NOT db/init/02_seed.sql's full demo
-- dataset, which is unnecessary weight for tests that seed their own fixtures per test.
-- (02_seed.sql itself had a bug, fixed 2026-08-30, that made it fail on any fresh database —
-- see MAINTAINABILITY_PLAN.md step 6 — but that's no longer why this file stays minimal.)
INSERT INTO currency (code, name, symbol, is_active, is_base) VALUES
    ('INR', 'Indian Rupee', '₹', TRUE, TRUE)
ON CONFLICT (code) DO NOTHING;

INSERT INTO society (id, name, address, city, contact_email, base_currency) VALUES
    ('11100000-0000-0000-0000-000000000001',
     'Test Society', '1 Test Street', 'Bengaluru', 'admin@test.local', 'INR')
ON CONFLICT (id) DO NOTHING;
