-- Optional vehicle number plate for a walk-in visitor (no QR pass) — mirrors
-- visitor_pass.vehicle_number (see 003_visitor_vehicle_number.sql). Security
-- can set it at logging time or edit it afterward via PATCH /gate/anonymous/{id}.
--
-- Run: docker exec -i society_visitor_postgres psql -U <user> -d visitor_service < services/visitor/db/migrations/006_anonymous_vehicle_number.sql

ALTER TABLE anonymous_visitor ADD COLUMN IF NOT EXISTS vehicle_number TEXT;
