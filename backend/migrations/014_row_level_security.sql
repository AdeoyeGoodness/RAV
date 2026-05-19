-- Migration 014: Row-Level Security (Multi-Tenant Isolation)
-- 
-- PURPOSE: Ensure that org_admin and org_user roles can ONLY access
-- data belonging to their organization, even if application code has a bug.
-- RLS acts as a database-level safety net.
--
-- HOW IT WORKS:
--   1. Each request sets: SET LOCAL app.current_org_id = '<org-uuid>';
--   2. RLS policies filter all SELECT/INSERT/UPDATE/DELETE to match that org_id.
--   3. Super admins set app.current_org_id = 'BYPASS' to skip filtering.
--   4. If app.current_org_id is not set, NO rows are visible (fail-closed).

-- ============================================================
-- STEP 1: Enable RLS on all tenant-scoped tables
-- ============================================================

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE archives ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: Create RLS policies
-- ============================================================
-- Pattern: Allow access when:
--   a) app.current_org_id matches the row's organization_id, OR
--   b) app.current_org_id is 'BYPASS' (super admin mode)
--
-- Using current_setting('app.current_org_id', true) with true = 
-- return NULL if not set (fail-closed: no rows match NULL).
-- ============================================================

-- === AGENTS ===
DROP POLICY IF EXISTS agents_org_isolation ON agents;
CREATE POLICY agents_org_isolation ON agents
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );

-- === EVENTS ===
DROP POLICY IF EXISTS events_org_isolation ON events;
CREATE POLICY events_org_isolation ON events
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );

-- === FILES ===
DROP POLICY IF EXISTS files_org_isolation ON files;
CREATE POLICY files_org_isolation ON files
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );

-- === USERS ===
-- Users with NULL organization_id are super_admins (visible only in BYPASS mode)
DROP POLICY IF EXISTS users_org_isolation ON users;
CREATE POLICY users_org_isolation ON users
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );

-- === AUDIT_LOGS ===
DROP POLICY IF EXISTS audit_logs_org_isolation ON audit_logs;
CREATE POLICY audit_logs_org_isolation ON audit_logs
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );

-- === ARCHIVES ===
DROP POLICY IF EXISTS archives_org_isolation ON archives;
CREATE POLICY archives_org_isolation ON archives
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );

-- ============================================================
-- STEP 3: Force RLS even for table owners
-- ============================================================
-- By default, table owners (rav_user) bypass RLS.
-- FORCE makes RLS apply to the owner too, so our app connection
-- is always subject to the policies.
-- ============================================================

ALTER TABLE agents FORCE ROW LEVEL SECURITY;
ALTER TABLE events FORCE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE archives FORCE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 4: Organizations table does NOT have RLS
-- ============================================================
-- The organizations table itself is not org-scoped.
-- Access control for it is handled at the application layer
-- (only super_admins can list/modify organizations).
-- organization_settings follows the same org_id pattern:

ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_settings_isolation ON organization_settings;
CREATE POLICY org_settings_isolation ON organization_settings
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );
