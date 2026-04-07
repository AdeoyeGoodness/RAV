-- 012_org_settings.sql
-- Fulfills Item 12.4 Enhancement: Dynamic SMTP Configuration via UI

CREATE TABLE IF NOT EXISTS organization_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) UNIQUE,
    smtp_host TEXT,
    smtp_port INTEGER,
    smtp_username TEXT,
    smtp_password_encrypted TEXT, -- Encrypted at rest
    smtp_from_email TEXT,
    smtp_enabled BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_org ON organization_settings(organization_id);
