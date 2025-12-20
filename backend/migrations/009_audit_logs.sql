-- Create actor_type enum
CREATE TYPE actor_type AS ENUM ('super_admin', 'org_admin', 'system');

-- Create audit_logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actor_type actor_type NOT NULL,
    actor_id UUID, -- Nullable for system actions
    organization_id UUID, -- Nullable for global super_admin actions
    action_type VARCHAR(255) NOT NULL, -- e.g. ORG_CREATED, DATA_RESTORED
    target_type VARCHAR(255) NOT NULL, -- e.g. ORGANIZATION, AGENT, TOKEN
    target_id VARCHAR(255), -- ID of the target object (UUID or String)
    metadata JSONB DEFAULT '{}', -- Structured details
    ip_address VARCHAR(45), -- IPv6 support
    user_agent TEXT
);

-- Indices for fast searching/filtering
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_organization_id ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_actor_id ON audit_logs(actor_id);
CREATE INDEX idx_audit_logs_action_type ON audit_logs(action_type);
