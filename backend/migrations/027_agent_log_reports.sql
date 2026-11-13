-- Agent log reports: an admin-initiated (or auto-on-trouble) pull of an endpoint's
-- own diagnostic log, surfaced as a plain-language health report plus the raw log for IT.
--
-- Rides the heartbeat command channel: a 'requested' row makes the backend include a
-- collect_logs command in that agent's next heartbeat response. The agent uploads its
-- recent agent.log (via /files/upload with a logrep_<id> file id), the backend parses it
-- into plain-language "problems" and marks the row 'ready'. Org-scoped, FORCE RLS like
-- the other agent tables (migration 014's pattern).

CREATE TABLE IF NOT EXISTS agent_log_reports (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id         TEXT NOT NULL,
    organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    status           TEXT NOT NULL DEFAULT 'requested',  -- requested | ready | failed
    trigger_kind     TEXT NOT NULL DEFAULT 'manual',     -- manual | auto
    requested_by     UUID,                               -- user id that asked (NULL for auto)
    reason           TEXT,                               -- why it was auto-triggered
    file_id          TEXT,                               -- uploaded raw log (files table)
    problems         JSONB,                              -- parsed plain-language problems
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_log_reports_agent
    ON agent_log_reports (agent_id, requested_at DESC);

-- Fast lookup of a still-pending pull for an agent (drives the heartbeat command).
CREATE INDEX IF NOT EXISTS idx_log_reports_pending
    ON agent_log_reports (agent_id) WHERE status = 'requested';

ALTER TABLE agent_log_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_log_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS log_reports_org_isolation ON agent_log_reports;
CREATE POLICY log_reports_org_isolation ON agent_log_reports
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );
