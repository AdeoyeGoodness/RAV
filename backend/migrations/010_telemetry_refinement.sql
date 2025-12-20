-- Add severity and category to events table for better telemetry exploration
-- Using VARCHAR for flexibility, but expected values:
-- Category: system, user, process, network, file, security
-- Severity: low, medium, high, critical

ALTER TABLE events 
ADD COLUMN IF NOT EXISTS severity VARCHAR(20) DEFAULT 'low',
ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'system';

-- Create indices for performant surgical filtering
CREATE INDEX IF NOT EXISTS idx_events_severity ON events(severity);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_org_ts ON events(organization_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_agent_ts ON events(agent_id, timestamp DESC);

-- Update existing records to reasonable defaults if necessary (already set via DEFAULT)
-- But we can populate based on event_type patterns later if needed.
