-- Anonymous/walk-in visitor entries only required `purpose` at launch; security
-- asked for the same optional identity fields the resident pass-creation form
-- has (name/contact/aadhaar/email/address) so a walk-in can be logged with more
-- detail when there's time to ask, without making any of it mandatory.
-- Run: docker exec -i society_visitor_postgres psql -U <user> -d visitor_service < services/visitor/db/migrations/001_anonymous_visitor_details.sql
ALTER TABLE anonymous_visitor ADD COLUMN IF NOT EXISTS visitor_name TEXT;
ALTER TABLE anonymous_visitor ADD COLUMN IF NOT EXISTS contact TEXT;
ALTER TABLE anonymous_visitor ADD COLUMN IF NOT EXISTS aadhaar TEXT;
ALTER TABLE anonymous_visitor ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE anonymous_visitor ADD COLUMN IF NOT EXISTS address TEXT;
