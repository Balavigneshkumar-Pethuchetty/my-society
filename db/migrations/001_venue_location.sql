-- Migration 001: add venue location fields to event table
-- Safe to run multiple times (uses IF NOT EXISTS / idempotent)

ALTER TABLE event ADD COLUMN IF NOT EXISTS venue_lat      DOUBLE PRECISION;
ALTER TABLE event ADD COLUMN IF NOT EXISTS venue_lng      DOUBLE PRECISION;
ALTER TABLE event ADD COLUMN IF NOT EXISTS venue_place_id TEXT;
ALTER TABLE event ADD COLUMN IF NOT EXISTS venue_address  TEXT;
