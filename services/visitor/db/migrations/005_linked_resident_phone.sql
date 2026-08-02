-- Cache the linked resident's phone number on anonymous_visitor at write time,
-- same pattern as linked_resident_name/linked_resident_flat (see 01_schema.sql's
-- rationale — a ledger/call-list shouldn't depend on user-service's uptime).
-- Lets security tap-to-call the resident a walk-in visitor was logged against.
--
-- Run: docker exec -i society_visitor_postgres psql -U <user> -d visitor_service < services/visitor/db/migrations/005_linked_resident_phone.sql

ALTER TABLE anonymous_visitor ADD COLUMN IF NOT EXISTS linked_resident_phone TEXT;
