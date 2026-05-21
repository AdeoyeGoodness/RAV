-- Backfill events.category from event_type.
--
-- Older rows were all stored as 'system' because the agent never sends a category and the ingest
-- handler defaulted to "system". The handler now derives the category (categorize_event); this
-- recategorizes existing rows so the dashboard activity bars and category filters work immediately
-- instead of waiting for 24h of fresh telemetry.
--
-- events has FORCE ROW LEVEL SECURITY (migration 014), which applies even to the table owner, so a
-- plain UPDATE here would match zero rows. The policy treats app.current_org_id = 'BYPASS' as
-- "see everything"; set it (session scope, robust whether or not the migration runs in a tx).
SELECT set_config('app.current_org_id', 'BYPASS', false);

-- CASE order must match categorize_event() in backend/src/api/handlers.rs (first match wins).
UPDATE events SET category = CASE
    WHEN event_type ILIKE '%screenshot%' THEN 'screenshot'
    WHEN event_type ILIKE '%usb%' OR event_type ILIKE '%file_transfer%' THEN 'file'
    WHEN event_type ILIKE '%browser%'
      OR event_type ILIKE '%history%'
      OR event_type ILIKE '%active_tab%'
      OR event_type ILIKE '%tab_updated%'
      OR event_type ILIKE '%search%'
      OR event_type ILIKE '%download%' THEN 'browser'
    WHEN event_type ILIKE '%network%'
      OR event_type ILIKE '%connection%'
      OR event_type ILIKE '%wifi%' THEN 'network'
    WHEN event_type ILIKE '%process%' THEN 'process'
    ELSE 'system'
END
WHERE category IS NULL OR category = 'system';
