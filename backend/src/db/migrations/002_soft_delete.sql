-- Migration: Add soft delete support
-- This adds a deleted_at column to enable soft deletes

-- Add deleted_at column to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for filtering non-deleted events efficiently
CREATE INDEX IF NOT EXISTS idx_events_deleted_at ON events(deleted_at);

-- Add deleted_at column to agents table (for future use)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
