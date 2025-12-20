-- Add deleted_at column to files table
ALTER TABLE files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Add index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_files_deleted_at ON files(deleted_at);
