-- Remote agent-health detection: two new signal sources beyond heartbeat so the
-- backend can distinguish stopped / killed / removed / off from "silent."
--
--   1. Watchdog snapshot (single row per agent, latest only). Posted every few
--      minutes by a Scheduled Task on the endpoint that runs INDEPENDENTLY of
--      the main service, so it keeps reporting even when the service is dead.
--      Tells us: is the service Running/Stopped/NotInstalled? Is the binary
--      still on disk? (lets us split "killed" from "removed").
--
--   2. Lifecycle events (small history). The main agent posts these on graceful
--      startup ("started") and just before exit ("stopping" / "uninstalling"),
--      so a recent "stopping" before silence means admin-initiated stop, not
--      crash. Auto-cleanup keeps the table small.

-- 1) Watchdog snapshot lives on the agents row itself — only the most recent
--    reading is needed; older readings are not interesting.
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS watchdog_last_seen      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS watchdog_service_state  TEXT,
    ADD COLUMN IF NOT EXISTS watchdog_binary_present BOOLEAN,
    ADD COLUMN IF NOT EXISTS watchdog_version        TEXT;

-- 2) Lifecycle event history. Org-scoped, FORCE RLS like the other event
--    tables (migration 014's pattern).
CREATE TABLE IF NOT EXISTS agent_lifecycle_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        TEXT NOT NULL,
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    state           TEXT NOT NULL,   -- 'started' | 'stopping' | 'uninstalling'
    reason          TEXT,
    reported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_agent_received
    ON agent_lifecycle_events (agent_id, received_at DESC);

ALTER TABLE agent_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_lifecycle_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lifecycle_org_isolation ON agent_lifecycle_events;
CREATE POLICY lifecycle_org_isolation ON agent_lifecycle_events
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );
