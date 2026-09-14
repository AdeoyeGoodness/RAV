-- One-shot backfill: populate agents.last_archived_at from the archives table
-- so the dashboard's new "Last archive" cell reflects historical archives, not
-- just archives created after this migration lands. The column has existed
-- since migration 011 but was never written; going forward the archive
-- service in services/archive.rs::archive_agent_telemetry stamps it on every
-- successful archive.
--
-- BYPASS RLS via app.current_org_id = 'BYPASS' — both agents and archives
-- carry FORCE ROW LEVEL SECURITY and the migration runner has no per-org
-- context. Same escape hatch used by every other cross-org migration.

SET LOCAL app.current_org_id = 'BYPASS';

UPDATE agents a
   SET last_archived_at = sub.max_created
  FROM (
      SELECT agent_id, organization_id, MAX(created_at) AS max_created
      FROM archives
      GROUP BY agent_id, organization_id
  ) sub
 WHERE a.agent_id = sub.agent_id
   AND a.organization_id = sub.organization_id
   AND (a.last_archived_at IS NULL OR a.last_archived_at < sub.max_created);
