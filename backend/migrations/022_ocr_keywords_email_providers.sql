-- Extend the global OCR keyword list with common webmail provider names so
-- screenshots showing a logged-in mail session get flagged as critical.
-- Separate migration (not an edit to 021) because 021 has already been applied
-- on deployed databases and sqlx verifies migration checksums.
--
-- Matching is case-insensitive substring (see services/ocr.rs::find_matches),
-- so the stored casing here is cosmetic. NULL organization_id = platform-wide
-- default seen by every org.
--
-- SET LOCAL row_security = off — sensitive_keywords has FORCE ROW LEVEL SECURITY
-- from migration 021. Without this bypass the migration runner (which never
-- sets app.current_org_id) is rejected by the RLS policy on INSERT, and the
-- backend crashes at startup in a PM2 restart loop. Same fix pattern we
-- applied to seed data in migration 021 (commit bd35bc4).

SET LOCAL row_security = off;

INSERT INTO sensitive_keywords (organization_id, keyword) VALUES
    (NULL, 'yahoo'),
    (NULL, 'gmail')
ON CONFLICT (organization_id, keyword) DO NOTHING;
