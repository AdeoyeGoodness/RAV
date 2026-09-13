-- Remove 'EIB' from the sensitive keyword catalog everywhere it appears.
-- EIB is the operator's own company name; it's baked into virtually every
-- screenshot (letterhead, logos, email domains, filenames), so the OCR
-- scanner was flagging almost every capture as Critical and drowning the
-- Forensic Alerts feed. Same class of noise fix we applied for 'RAV'
-- earlier — the platform should not flag its own operator's brand.
--
-- Scope: BOTH the global (organization_id IS NULL) copy and any per-org
-- copies orgs may have added themselves. Case-insensitive so 'EIB',
-- 'eib' and 'Eib' all go. Non-EIB keywords with 'eib' embedded (e.g.
-- 'seibert') are protected by the exact-match check.
--
-- Bypass RLS via app.current_org_id = 'BYPASS' — same escape hatch every
-- other keyword-touching migration uses.

SET LOCAL app.current_org_id = 'BYPASS';

-- Snapshot the affected files BEFORE the delete so they get re-scanned and
-- the 'EIB' hit drops off their match list. Anything that was ONLY flagged
-- because of EIB will lose its critical status; anything that was flagged
-- for other keywords too keeps its status once OCR re-runs.
UPDATE files
   SET ocr_status = 'pending',
       ocr_matches = '{}',
       is_critical = FALSE,
       ocr_processed_at = NULL,
       ocr_error = NULL
 WHERE 'EIB' = ANY(ocr_matches)
    OR 'eib' = ANY(ocr_matches);

DELETE FROM sensitive_keywords
 WHERE LOWER(keyword) = 'eib';
