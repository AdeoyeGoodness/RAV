-- =============================================================================
-- 013_enterprise_hardening_v2.sql
-- Implements fixes.md §1 (Enrollment Token Security), §5 (Telemetry Gaps),
-- §7 (Data Deletion & Restore), and §10 (Proposed Schema)
-- 
-- ALL CHANGES ARE ADDITIVE — no columns dropped, no tables renamed.
-- Safe to run on a production database with existing data.
-- =============================================================================


-- =============================================================================
-- PART 1: ENROLLMENT TOKEN SYSTEM (fixes.md §1)
-- Separates tokens from the organizations table into their own lifecycle.
-- Supports: hashed storage, revocation, expiry, per-token agent limits.
-- =============================================================================

CREATE TABLE IF NOT EXISTS enrollment_tokens (
    token_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    token_hash      TEXT NOT NULL UNIQUE,   -- SHA256 of raw token; raw token NEVER stored
    label           TEXT,                    -- Human-readable name, e.g. "NYC Office Rollout"
    max_agents      INTEGER,                -- NULL = unlimited
    expires_at      TIMESTAMPTZ,            -- NULL = never expires
    revoked         BOOLEAN NOT NULL DEFAULT false,
    revoked_at      TIMESTAMPTZ,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_org ON enrollment_tokens(org_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_tokens_hash ON enrollment_tokens(token_hash);

COMMENT ON TABLE enrollment_tokens IS 'Enrollment tokens used by agents to join an organization. Tokens are stored as SHA256 hashes.';
COMMENT ON COLUMN enrollment_tokens.token_hash IS 'SHA256 hash of the raw enrollment token. The raw value is shown once at creation and never stored.';


-- =============================================================================
-- PART 2: ENROLLMENT RULES (fixes.md §1)
-- Per-token constraints: OS type, IP range, geo restrictions.
-- =============================================================================

CREATE TABLE IF NOT EXISTS enrollment_rules (
    rule_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id        UUID NOT NULL REFERENCES enrollment_tokens(token_id) ON DELETE CASCADE,
    rule_type       TEXT NOT NULL,   -- 'os_type', 'ip_range', 'geo_country'
    rule_value      TEXT NOT NULL    -- e.g. 'windows', '197.210.0.0/16', 'NG'
);

CREATE INDEX IF NOT EXISTS idx_enrollment_rules_token ON enrollment_rules(token_id);

COMMENT ON TABLE enrollment_rules IS 'Constraints applied to enrollment tokens. Each rule restricts which agents can enroll using a given token.';
COMMENT ON COLUMN enrollment_rules.rule_type IS 'Type of rule: os_type, ip_range, or geo_country.';


-- =============================================================================
-- PART 3: ENROLLMENT ATTEMPTS LOG (fixes.md §1)
-- Every enrollment attempt is logged — accepted or rejected, with reason.
-- A spike in rejections = a leaked token.
-- =============================================================================

CREATE TABLE IF NOT EXISTS enrollment_attempts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id            UUID REFERENCES enrollment_tokens(token_id),
    machine_fingerprint TEXT,
    ip_address          INET,
    geo_country         TEXT,
    os_type             TEXT,
    hostname            TEXT,
    outcome             TEXT NOT NULL,
    -- Possible outcomes:
    --   'enrolled'             — success
    --   'reinstall'            — existing agent re-enrolled (same fingerprint)
    --   'rejected_max'         — max_agents limit hit
    --   'rejected_ip'          — IP not in allowed range
    --   'rejected_os'          — OS type not allowed
    --   'rejected_geo'         — country not allowed
    --   'rejected_expired'     — token past expires_at
    --   'rejected_revoked'     — token was revoked
    --   'rejected_unknown'     — token hash not found
    attempted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollment_attempts_token ON enrollment_attempts(token_id);
CREATE INDEX IF NOT EXISTS idx_enrollment_attempts_outcome ON enrollment_attempts(outcome);
CREATE INDEX IF NOT EXISTS idx_enrollment_attempts_time ON enrollment_attempts(attempted_at DESC);

COMMENT ON TABLE enrollment_attempts IS 'Audit log of every enrollment attempt. Used for security monitoring — rejection spikes indicate token leakage.';


-- =============================================================================
-- PART 4: DELETION REQUESTS (fixes.md §7)
-- Three-tier deletion model: soft delete → hard delete request → GDPR purge.
-- =============================================================================

CREATE TABLE IF NOT EXISTS deletion_requests (
    request_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(id),
    requested_by    UUID NOT NULL REFERENCES users(id),
    scope           TEXT NOT NULL DEFAULT 'agent',  -- 'agent', 'org', 'events'
    target_id       TEXT,                            -- agent_id or NULL for org-wide
    tier            INTEGER NOT NULL,               -- 1 = soft, 2 = hard (permanent)
    reason          TEXT,                            -- Why the deletion was requested
    grace_until     TIMESTAMPTZ,                    -- Hard delete won't execute before this
    executed_at     TIMESTAMPTZ,                    -- When the hard delete was carried out
    cancelled_at    TIMESTAMPTZ,                    -- If super admin cancelled during grace
    cancelled_by    UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_org ON deletion_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_pending ON deletion_requests(tier, executed_at) 
    WHERE executed_at IS NULL AND cancelled_at IS NULL;

COMMENT ON TABLE deletion_requests IS 'Tracks data deletion lifecycle. Tier 1 = soft (restorable), Tier 2 = hard (permanent after grace period).';


-- =============================================================================
-- PART 5: EXTEND AGENTS TABLE
-- Add fields needed for enrollment token binding + agent metadata.
-- =============================================================================

-- Link agent to the specific enrollment token used
ALTER TABLE agents ADD COLUMN IF NOT EXISTS enrollment_token_id UUID REFERENCES enrollment_tokens(token_id);

-- Agent metadata (needed for enrollment rules + version management)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS os_type TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS os_version TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS agent_version TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- Unique constraint: same token + same machine = same agent (handles reinstalls)
-- Using a partial unique index to avoid conflicts with existing agents that have NULL token_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_token_fingerprint 
    ON agents(enrollment_token_id, hardware_fingerprint) 
    WHERE enrollment_token_id IS NOT NULL;

COMMENT ON COLUMN agents.enrollment_token_id IS 'The enrollment token used to register this agent. NULL for legacy agents enrolled before token system.';
COMMENT ON COLUMN agents.status IS 'Agent status: active, inactive, or revoked.';


-- =============================================================================
-- PART 6: EXTEND EVENTS TABLE (fixes.md §5)
-- Add observed flag and received_at for telemetry gap tracking.
-- =============================================================================

-- Distinguish directly observed events from inferred/reconstructed ones
ALTER TABLE events ADD COLUMN IF NOT EXISTS observed BOOLEAN DEFAULT true;

-- Separate capture time (agent-side) from receipt time (server-side)
-- The existing 'timestamp' column is the agent's captured_at.
-- received_at is when the backend actually got the event (important for offline agents).
ALTER TABLE events ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN events.observed IS 'true = agent directly observed this event. false = inferred or reconstructed (e.g., state mismatch after restart).';
COMMENT ON COLUMN events.received_at IS 'When the backend received this event. Compare with timestamp (captured_at) to measure sync delay.';


-- =============================================================================
-- PART 7: EXTEND ORGANIZATIONS TABLE
-- Add retention policy field.
-- =============================================================================

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS retention_days INTEGER DEFAULT 90;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN organizations.retention_days IS 'Number of days to retain telemetry data before archiving. Default 90.';


-- =============================================================================
-- DONE. All changes are additive. Existing data is untouched.
-- Next steps:
--   - Update backend Rust handlers to use enrollment_tokens instead of organizations.enrollment_token
--   - Update agent enrollment flow to POST token hash
--   - Add RLS policies (separate migration — §3)
-- =============================================================================
