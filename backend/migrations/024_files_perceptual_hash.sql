-- Perceptual-hash dedup for screenshots.
--
-- Operators complained about the Critical + Screenshots views being flooded
-- with near-identical frames from endpoints where the user sits on the same
-- screen for hours. Exact byte-hash dedup fails because timestamps, cursor
-- position, and clock ticks vary every frame. We add:
--
--   * image_hash            — 16-hex-char dHash (64-bit perceptual hash).
--                             Two images with a Hamming distance ≤ 5 in this
--                             hash look effectively identical to a human.
--   * duplicate_of_file_id  — points at the OLDER file this one duplicates.
--                             The oldest survivor of a cluster keeps NULL
--                             here; later frames in the cluster reference
--                             the survivor. Dashboard filters WHERE this is
--                             NULL to show one representative per cluster.
--
-- BOTH nullable so pre-existing rows keep working and non-image uploads
-- (archives, browser exports, etc.) don't need a hash.

ALTER TABLE files
    ADD COLUMN IF NOT EXISTS image_hash            TEXT,
    ADD COLUMN IF NOT EXISTS duplicate_of_file_id  TEXT;

-- Fast dedup lookup: given (agent, recent time window, hash), find the newest
-- prior non-duplicate image. Partial index skips rows without a hash.
CREATE INDEX IF NOT EXISTS idx_files_dedup_lookup
    ON files (agent_id, created_at DESC)
    WHERE image_hash IS NOT NULL AND duplicate_of_file_id IS NULL;

-- Fast unique-only listing: dashboard critical/screenshots surfaces only
-- WHERE duplicate_of_file_id IS NULL.
CREATE INDEX IF NOT EXISTS idx_files_unique_representatives
    ON files (organization_id, agent_id, created_at DESC)
    WHERE duplicate_of_file_id IS NULL;
