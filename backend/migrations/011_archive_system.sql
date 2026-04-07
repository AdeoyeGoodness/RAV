-- 011_archive_system.sql
-- Fulfills Item 12: Weekly Telemetry Archiving & Purging

CREATE TABLE IF NOT EXISTS archives (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    agent_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    event_count INTEGER NOT NULL,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archives_agent ON archives(agent_id, organization_id);

-- Optional: Track when the last cleanup happened for an agent
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_archived_at TIMESTAMPTZ;
