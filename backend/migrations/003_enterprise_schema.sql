-- Create organizations table
CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) UNIQUE NOT NULL,
    license_key VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert a default organization for existing data
INSERT INTO organizations (id, name, license_key, status)
VALUES ('00000000-0000-0000-0000-000000000000', 'Default Organization', 'default-license-key', 'active')
ON CONFLICT (id) DO NOTHING;

-- Add organization_id to agents
ALTER TABLE agents ADD COLUMN organization_id UUID REFERENCES organizations(id);
UPDATE agents SET organization_id = '00000000-0000-0000-0000-000000000000' WHERE organization_id IS NULL;
ALTER TABLE agents ALTER COLUMN organization_id SET NOT NULL;

-- Add organization_id to events
ALTER TABLE events ADD COLUMN organization_id UUID REFERENCES organizations(id);
UPDATE events SET organization_id = '00000000-0000-0000-0000-000000000000' WHERE organization_id IS NULL;
ALTER TABLE events ALTER COLUMN organization_id SET NOT NULL;

-- Create indexes for organization_id
CREATE INDEX IF NOT EXISTS idx_agents_organization_id ON agents(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_organization_id ON events(organization_id);

-- Update trigger for organizations table
DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
