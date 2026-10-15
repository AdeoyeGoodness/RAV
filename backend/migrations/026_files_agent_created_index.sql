-- Supports the per-agent "latest activity" lookup in list_agents, which takes
-- MAX(files.created_at) per agent to count screenshot/file uploads toward a
-- device's recency (so a box busily uploading screenshots doesn't read as stale).
-- Without this, that correlated subquery scans the whole files table once per
-- agent and the whole list_agents query times out (30s) on a fleet of any size,
-- which starves the connection pool and blanks the dashboard.
--
-- Partial on (agent_id, created_at) WHERE deleted_at IS NULL: the subquery filters
-- by agent_id and deleted_at and takes the max created_at, so this lets Postgres
-- answer it with a single index lookup. Non-CONCURRENT because sqlx runs each
-- migration inside a transaction; IF NOT EXISTS so it's a no-op where it was
-- already created by hand during the incident recovery.
CREATE INDEX IF NOT EXISTS idx_files_agent_created
    ON files (agent_id, created_at)
    WHERE deleted_at IS NULL;
