-- Rename license_key to enrollment_token for better semantics
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='organizations' AND column_name='license_key') THEN
        ALTER TABLE organizations RENAME COLUMN license_key TO enrollment_token;
    END IF;
END $$;

-- Add professional constraints to enrollment tokens
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS token_expiry TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_agents INTEGER DEFAULT 1000;

-- Update existing organization token name for consistency
UPDATE organizations 
SET enrollment_token = 'default-enrollment-token' 
WHERE enrollment_token = 'default-license-key';

-- Add a comment for documentation
COMMENT ON COLUMN organizations.enrollment_token IS 'The token used by agents to authorize and join this organization.';
COMMENT ON COLUMN organizations.token_expiry IS 'Timestamp after which this token will no longer authorize new agent enrollments.';
COMMENT ON COLUMN organizations.max_agents IS 'The maximum number of agents allowed to enroll under this organization.';
