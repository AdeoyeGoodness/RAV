-- Track each agent's running CARGO_PKG_VERSION so the admin can confirm rollout
-- progress (e.g. how many agents have actually upgraded to 0.1.8) without needing
-- to walk up to a box. The agent already sends `version` in the heartbeat payload
-- (see Heartbeat in db/models.rs); we just persist it now.
--
-- NULL means we haven't heard from that agent since this column was added —
-- expected for any agent that hasn't heartbeated yet after the backend upgrade.
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS agent_version TEXT;
