-- Extend the global OCR keyword list with common webmail provider names so
-- screenshots showing a logged-in mail session get flagged as critical.
-- Separate migration (not an edit to 021) because 021 has already been applied
-- on deployed databases and sqlx verifies migration checksums.
--
-- Matching is case-insensitive substring (see services/ocr.rs::find_matches),
-- so the stored casing here is cosmetic. NULL organization_id = platform-wide
-- default seen by every org.
--
-- BYPASS via app.current_org_id — sensitive_keywords has FORCE ROW LEVEL
-- SECURITY from migration 021, whose write policy explicitly allows the
-- literal 'BYPASS' as an escape hatch:
--     current_setting('app.current_org_id', true) = 'BYPASS' OR …
-- We use the same escape hatch the OCR worker uses in services/ocr.rs;
-- SET LOCAL keeps it scoped to this migration's transaction.
--
-- (An earlier attempt used `SET LOCAL row_security = off` — that requires
-- the DB role to have BYPASSRLS on a FORCE-RLS table, which our app role
-- does not. Postgres then errored with "query would be affected by
-- row-level security policy" instead.)

SET LOCAL app.current_org_id = 'BYPASS';

INSERT INTO sensitive_keywords (organization_id, keyword) VALUES
    (NULL, 'yahoo'),
    (NULL, 'gmail')
ON CONFLICT (organization_id, keyword) DO NOTHING;
