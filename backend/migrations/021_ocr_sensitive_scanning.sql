-- Screenshot content-scanning: run OCR over every uploaded image, match the
-- extracted text against a configurable keyword list, and flag any hits so
-- admins get a per-endpoint "Critical" view of screenshots that contain
-- sensitive terms.
--
--   1) Extend `files` with the OCR pipeline state + match results.
--   2) Add `sensitive_keywords` — per-org, with NULL org_id meaning "global
--      default seen by every organization." Seeded with the initial list.

-- 1) OCR pipeline columns on files.
ALTER TABLE files
    ADD COLUMN IF NOT EXISTS ocr_status       TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS ocr_matches      TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS is_critical      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ocr_processed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS ocr_error        TEXT;

-- Fast lookup for the background worker: "next N files to OCR."
CREATE INDEX IF NOT EXISTS idx_files_ocr_pending
    ON files (created_at)
    WHERE ocr_status = 'pending';

-- Fast lookup for the dashboard: "critical images for this agent."
CREATE INDEX IF NOT EXISTS idx_files_critical_agent
    ON files (organization_id, agent_id, created_at DESC)
    WHERE is_critical = TRUE;

-- 2) Sensitive keyword catalog. NULL organization_id = seen by every org
-- (platform-wide default); a per-org row overrides / adds to the defaults.
CREATE TABLE IF NOT EXISTS sensitive_keywords (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    keyword         TEXT NOT NULL,
    is_regex        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, keyword)
);

-- Read policy: an org sees its own keywords + all globals. Write policy: only
-- rows scoped to the caller's org (globals are seeded here / by super-admin
-- tooling, not by the org UI).
ALTER TABLE sensitive_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensitive_keywords FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sensitive_keywords_read ON sensitive_keywords;
CREATE POLICY sensitive_keywords_read ON sensitive_keywords
    FOR SELECT
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id IS NULL
        OR organization_id::text = current_setting('app.current_org_id', true)
    );

DROP POLICY IF EXISTS sensitive_keywords_write ON sensitive_keywords;
CREATE POLICY sensitive_keywords_write ON sensitive_keywords
    FOR ALL
    USING (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    )
    WITH CHECK (
        current_setting('app.current_org_id', true) = 'BYPASS'
        OR organization_id::text = current_setting('app.current_org_id', true)
    );

-- Seed the initial global keyword list. ON CONFLICT is a no-op so the migration
-- is idempotent if it runs after tweaks.
INSERT INTO sensitive_keywords (organization_id, keyword) VALUES
    (NULL, 'ARGUS'),
    (NULL, 'BELLO'),
    (NULL, 'TURJI'),
    (NULL, 'ECHEFU'),
    (NULL, 'BRIGHT'),
    (NULL, 'BUAS'),
    (NULL, 'RAV'),
    (NULL, 'AGENT'),
    (NULL, 'TELEMETRY')
ON CONFLICT (organization_id, keyword) DO NOTHING;
