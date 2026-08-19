-- Extend the global OCR keyword list with common webmail provider names so
-- screenshots showing a logged-in mail session get flagged as critical.
-- Separate migration (not an edit to 021) because 021 has already been applied
-- on deployed databases and sqlx verifies migration checksums.
--
-- Matching is case-insensitive substring (see services/ocr.rs::find_matches),
-- so the stored casing here is cosmetic. NULL organization_id = platform-wide
-- default seen by every org.

INSERT INTO sensitive_keywords (organization_id, keyword) VALUES
    (NULL, 'yahoo'),
    (NULL, 'gmail')
ON CONFLICT (organization_id, keyword) DO NOTHING;
