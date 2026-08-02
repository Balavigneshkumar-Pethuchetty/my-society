-- Optional vehicle number plate for a visitor pass. Guests sometimes arrive
-- by car/bike; the resident can note it at pass creation, and security at
-- the gate can add/correct it on arrival if it wasn't caught upfront or was
-- entered wrong (see routes/passes.py update_pass — security_guard callers
-- are restricted to only this field, not the rest of the pass).
--
-- Run: docker exec -i society_visitor_postgres psql -U <user> -d visitor_service < services/visitor/db/migrations/003_visitor_vehicle_number.sql

ALTER TABLE visitor_pass ADD COLUMN IF NOT EXISTS vehicle_number TEXT;
