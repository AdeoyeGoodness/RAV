-- Human-friendly device name shown in the dashboard alongside (or instead of) the cryptic
-- hostname / agent_id. The agent_id stays as the immutable identity used by every query,
-- index, foreign key, and audit log; display_name is purely a label org admins can edit so
-- that "DESKTOP-HGOGOGL-6fb2fb43fab6" can be shown as "Jane's Laptop (Finance)" in lists.
--
-- Nullable on purpose: when NULL the dashboard falls back to hostname, then to agent_id.
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS display_name TEXT;
