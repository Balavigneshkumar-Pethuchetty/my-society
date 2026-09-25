-- Add missing payment columns for manual UPI payment flow
--
-- The registration_svc.payment table was initially created without columns
-- for manual payment review (screenshot_path, utr_number, review_notes, reviewed_at).
-- These columns were added in earlier migrations (006, 007, etc.) to the old
-- payment table but were not included in the new schema definition during
-- service isolation. This migration ensures both existing and new databases
-- have these columns.
--
-- Idempotent: IF NOT EXISTS guards on all ALTER TABLE statements.

DO $$
BEGIN
  -- Add screenshot_path for UPI payment verification screenshots
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'registration_svc'
    AND table_name = 'payment'
    AND column_name = 'screenshot_path'
  ) THEN
    ALTER TABLE registration_svc.payment ADD COLUMN screenshot_path TEXT;
  END IF;

  -- Add utr_number for UPI transaction reference
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'registration_svc'
    AND table_name = 'payment'
    AND column_name = 'utr_number'
  ) THEN
    ALTER TABLE registration_svc.payment ADD COLUMN utr_number VARCHAR(100);
  END IF;

  -- Add review_notes for admin comments during manual payment review
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'registration_svc'
    AND table_name = 'payment'
    AND column_name = 'review_notes'
  ) THEN
    ALTER TABLE registration_svc.payment ADD COLUMN review_notes TEXT;
  END IF;

  -- Add reviewed_at for tracking when payment was reviewed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'registration_svc'
    AND table_name = 'payment'
    AND column_name = 'reviewed_at'
  ) THEN
    ALTER TABLE registration_svc.payment ADD COLUMN reviewed_at TIMESTAMPTZ;
  END IF;
END $$;
