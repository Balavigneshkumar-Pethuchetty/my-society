-- Visitor category: lets a resident mark a pass as a family member visiting
-- vs. any other guest. Purely cosmetic (drives which themed background the
-- composited pass-image.png uses, see app/pass_image.py) — no behavior
-- differs by category anywhere else (entry/exit, notifications, etc.).
--
-- Run: docker exec -i society_visitor_postgres psql -U <user> -d visitor_service < services/visitor/db/migrations/004_visitor_category.sql

ALTER TABLE visitor_pass ADD COLUMN IF NOT EXISTS visitor_category VARCHAR(20) NOT NULL DEFAULT 'other';

DO $$ BEGIN
    ALTER TABLE visitor_pass ADD CONSTRAINT visitor_pass_visitor_category_check CHECK (visitor_category IN ('family', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
