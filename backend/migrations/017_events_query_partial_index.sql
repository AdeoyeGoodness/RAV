-- Partial index supporting the dominant access pattern in query_events:
--   WHERE deleted_at IS NULL AND organization_id = <rls> ORDER BY timestamp DESC LIMIT N
--
-- The pre-existing idx_events_org_ts (organization_id, timestamp DESC) doesn't include the
-- deleted_at IS NULL predicate, so on a large events table the planner was scanning + sorting
-- far more rows than necessary — letting query_events hit the 30s statement_timeout under load
-- (see 2026-05-27 incident).
--
-- This index is a strict subset (excludes soft-deleted rows) so it's smaller AND lets the
-- planner index-scan with early termination at LIMIT — typically sub-second.
--
-- NOTE on rollout: on the live prod DB this was first created online with CONCURRENTLY (no
-- table lock). This migration uses the plain form so a fresh DB picks it up at startup; the
-- IF NOT EXISTS makes it a no-op on databases where it already exists.
CREATE INDEX IF NOT EXISTS idx_events_active_org_ts
    ON events (organization_id, timestamp DESC)
    WHERE deleted_at IS NULL;
