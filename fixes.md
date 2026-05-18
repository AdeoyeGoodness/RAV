# FIXES.md — Enterprise Grid Agent: Architecture Corrections & Implementation Proposals

> Generated from full architecture review. Covers every issue identified across the original conversation.  
> Ordered by severity: **Critical → High → Medium → Low**

---

## Table of Contents

1. [Critical — Enrollment Token Security](#1-critical--enrollment-token-security)
2. [Critical — Auto-Update Binary Signing](#2-critical--auto-update-binary-signing)
3. [Critical — Multi-Tenant DB Isolation](#3-critical--multi-tenant-db-isolation)
4. [High — Agent SQLite Security](#4-high--agent-sqlite-security)
5. [High — Telemetry Gap Logging](#5-high--telemetry-gap-logging)
6. [High — Dashboard Separation & Scoping](#6-high--dashboard-separation--scoping)
7. [Medium — Data Deletion & Restore Model](#7-medium--data-deletion--restore-model)
8. [Medium — WiFi Telemetry Design](#8-medium--wifi-telemetry-design)
9. [Low — Deployment Architecture Clarity](#9-low--deployment-architecture-clarity)
10. [Proposed DB Schema (Full)](#10-proposed-db-schema-full)
11. [Enrollment Flow (Corrected End-to-End)](#11-enrollment-flow-corrected-end-to-end)
12. [Super Admin Dashboard — What to Show](#12-super-admin-dashboard--what-to-show)

---

## 1. Critical — Enrollment Token Security

### What Was Wrong

The original suggestion of one-time-use tokens breaks bulk enrollment (10,000 machines cannot share a single burning token). Reusable tokens without any binding are a liability — a single leaked token lets an attacker enroll rogue machines indefinitely.

### The Fix

Replace one-time tokens with **org-scoped tokens bound by machine fingerprint**, enforced at the DB level.

**Core constraint:**

```sql
UNIQUE(token_id, machine_fingerprint)
```

This means:
- The same machine can re-enroll (handles reinstalls) and gets back the same `agent_id`
- A new machine with the same token is a distinct row, subject to enforcement rules
- The DB itself enforces this — not application logic

**Token lifecycle rules (set per token at creation time):**

| Rule | Type | Example Value | Effect |
|------|------|---------------|--------|
| `max_agents` | integer | `10000` | Reject enrollment #10,001 |
| `os_type` | string | `windows` | Reject non-Windows agents |
| `ip_range` | CIDR | `197.210.0.0/16` | Reject enrollments from outside range |
| `geo_country` | ISO code | `NG` | Reject enrollments from other countries |
| `expires_at` | timestamp | `+72 hours` | Token becomes invalid after window |

**Token revocation:**

- Set `revoked = true` on the token
- Issue a new token to the org admin
- Existing enrolled agents are **NOT affected** — they authenticate via `agent_id` + certificate after first enrollment
- The enrollment token is only ever used once per machine at first contact

**Rejected enrollments must be logged, not silently dropped.** A spike in rejections is your signal that a token has leaked.

```sql
CREATE TABLE enrollment_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id        UUID REFERENCES enrollment_tokens(token_id),
    machine_fingerprint TEXT,
    ip_address      INET,
    geo_country     TEXT,
    os_type         TEXT,
    outcome         TEXT NOT NULL,  -- 'enrolled', 'rejected_max', 'rejected_ip', 'rejected_os', 'rejected_expired', 'rejected_revoked'
    attempted_at    TIMESTAMPTZ DEFAULT now()
);
```

---

## 2. Critical — Auto-Update Binary Signing

### What Was Wrong

The original auto-update design fetches both the binary and its expected hash from the same backend. If your backend is compromised, an attacker controls both — the hash verification is meaningless. For an agent running as a Windows SYSTEM service, a compromised update channel is a full device takeover vector.

### The Fix

**Code signing is non-negotiable.** The agent must verify a cryptographic signature made by a private key that never touches your server.

**Correct update verification flow:**

```
Backend serves:
  - new binary (agent_v1.2.5.exe)
  - signature file (agent_v1.2.5.exe.sig)

Agent verifies:
  - signature using embedded public key
  - if valid → proceed with update
  - if invalid → abort, log, alert
```

**On Windows:** Use `signtool` to sign your Rust binary with a code-signing certificate. The agent can verify using Windows Authenticode APIs, or you can embed your public key directly in the agent binary and verify the signature yourself.

**Safe binary replacement sequence:**

```
1. Download new binary to temp path  →  agent_new.exe
2. Verify signature against embedded public key
3. If verification fails → delete temp, abort, log event
4. Stop Windows service
5. Rename agent.exe → agent_old.exe
6. Rename agent_new.exe → agent.exe
7. Start Windows service
8. On failed start → rollback: rename agent_old.exe → agent.exe, restart
```

**Version check endpoint:**

```json
GET /agent/version-check
Headers: Authorization: Bearer <agent_jwt>

Response:
{
  "update_required": true,
  "latest_version": "1.2.5",
  "download_url": "https://cdn.yourplatform.com/agent/1.2.5/windows/agent.exe",
  "signature_url": "https://cdn.yourplatform.com/agent/1.2.5/windows/agent.exe.sig",
  "minimum_version": "1.1.0"
}
```

The `minimum_version` field lets you force-retire old agents with known vulnerabilities.

---

## 3. Critical — Multi-Tenant DB Isolation

### What Was Wrong

"Add `org_id` to every query" relies entirely on developer discipline. One missing `WHERE org_id = ?` clause is a cross-tenant data leak. Application-level enforcement is not sufficient for a product handling endpoint security data.

### The Fix

Enforce isolation at the **database layer**, not the application layer.

**Option A — Row-Level Security (Postgres, recommended):**

```sql
-- Enable RLS on every tenant-data table
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vulnerabilities ENABLE ROW LEVEL SECURITY;

-- Policy: application can only see rows matching its org_id
CREATE POLICY org_isolation ON agents
    USING (org_id = current_setting('app.current_org_id')::uuid);

-- Set at the start of every request
SET LOCAL app.current_org_id = 'acme-corp-uuid-here';
```

This means even if a developer forgets the WHERE clause, the DB silently filters to the correct tenant. You cannot accidentally leak data between orgs.

**Option B — Schema-per-tenant (for very high isolation requirements):**

Each org gets their own Postgres schema. More operational overhead, complete logical separation. Use only if a customer contractually requires it.

**What must never happen:**

- A query on `telemetry_events` without an `org_id` filter reaching production
- The super admin API reusing the same DB role as the org admin API
- Any `JOIN` across org boundaries in the application layer

---

## 4. High — Agent SQLite Security

### What Was Wrong

The SQLite file on each endpoint was described as a straightforward improvement with no discussion of who can read it, where it lives, or whether it's protected.

### The Fix

**File location:**

```
C:\ProgramData\YourAgent\data\agent.db
```

Set NTFS permissions so only `SYSTEM` and your service account can read/write. Local users and even local admins should not have access without elevation.

**Permissions (set during MSI install):**

```
icacls "C:\ProgramData\YourAgent\data" /inheritance:r /grant "SYSTEM:(OI)(CI)F" /grant "Administrators:(OI)(CI)F"
```

**Encryption at rest:**

Use SQLCipher (SQLite with AES-256 encryption) or encrypt the file-level key using DPAPI (Windows Data Protection API). The encryption key is derived from machine-specific secrets — not hardcoded.

```rust
// Derive key using Windows DPAPI
// Key is tied to machine identity, not portable
let key = dpapi::protect_data(&machine_fingerprint_bytes, None)?;
```

**What to store in agent SQLite:**

```sql
CREATE TABLE agent_state (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    updated_at INTEGER NOT NULL  -- unix timestamp
);

-- Examples:
-- key: 'last_ssid', value: 'OfficeWifi'
-- key: 'last_bssid', value: 'aa:bb:cc:dd:ee:ff'
-- key: 'agent_version', value: '1.2.5'
-- key: 'last_checkin', value: '1747555200'
```

**What NOT to store in agent SQLite:**

- Raw telemetry beyond the immediate reconciliation window
- Other orgs' data (should be impossible by design, but worth stating)
- Credentials or secrets in plaintext

---

## 5. High — Telemetry Gap Logging

### What Was Wrong

The original response acknowledged that if the agent is offline and the user changes Wi-Fi 5 times, you only see the last transition — and said "that's okay, just understand the limitation." For a security product, this is not acceptable as a silent gap.

### The Fix

**Log the gap itself as a telemetry event.**

When the agent starts up after an offline period, it must emit:

```json
{
  "event_type": "AGENT_OFFLINE_PERIOD",
  "agent_id": "uuid",
  "org_id": "uuid",
  "offline_from": "2026-05-18T01:00:00Z",
  "offline_to":   "2026-05-18T09:00:00Z",
  "duration_seconds": 28800,
  "state_before_offline": {
    "ssid": "OfficeWifi",
    "bssid": "aa:bb:cc:dd:ee:ff"
  },
  "state_after_restart": {
    "ssid": "MobileHotspot",
    "bssid": "11:22:33:44:55:66"
  },
  "transitions_observed": 0,
  "note": "State change detected after restart. Intermediate transitions not observable."
}
```

This tells investigators:

- There is a known blind spot from T1 to T2
- The device changed networks during that window
- No attempt is made to fabricate intermediate events

**Distinguish event types clearly:**

| Event Type | Meaning |
|---|---|
| `NETWORK_CONNECTED` | Agent directly observed connection |
| `NETWORK_DISCONNECTED` | Agent directly observed disconnection |
| `NETWORK_CHANGED` | Agent observed live SSID transition |
| `NETWORK_CHANGE_INFERRED` | State mismatch detected on restart |
| `AGENT_OFFLINE_PERIOD` | Gap record — agent was not running |

Never mark an inferred event as directly observed. The distinction matters in incident investigations.

---

## 6. High — Dashboard Separation & Scoping

### What Was Wrong

The agent was conflating super admin data access with org admin data access. The correct model was described verbally but never translated into concrete API route separation.

### The Fix

**Two completely separate API surface areas:**

**Super Admin API** (`/platform/...`):
- Authenticated as `platform_owner` role
- Sees org metadata only by default
- Can scope into an org explicitly

**Org Admin API** (`/org/{org_id}/...`):
- Authenticated as `org_admin` or `org_viewer` role
- Always scoped — cannot escape their `org_id`
- No awareness of other orgs

**Super Admin Dashboard — default view:**

```
Organizations
─────────────────────────────────────────────────────
Acme Corp          │ 10,234 agents │ ● Healthy  │ Last seen: 2m ago
Beta Industries    │  1,204 agents │ ⚠ Warning  │ Last seen: 1h ago
Gamma Ltd          │    340 agents │ ● Healthy  │ Last seen: 5m ago
─────────────────────────────────────────────────────
```

No endpoint-level data visible here. No hostnames, no IPs, no telemetry.

**After clicking into an org:**

```
[Viewing as: Platform Owner → Acme Corp]  ← always show this banner

Agents │ Telemetry │ Vulnerabilities │ Enrollment │ Settings
```

The banner must always be visible when you are scoped into an org. This prevents accidental confusion about whose data you are looking at.

**Suspicious enrollment alerts on super admin view:**

```
⚠ 2 rejected enrollment attempts on Acme Corp in the last 24h
   [View Details]
```

This is the only time endpoint-adjacent data surfaces at the platform level — and it is a security alert, not raw data.

---

## 7. Medium — Data Deletion & Restore Model

### What Was Wrong

The restore model was described without addressing GDPR/data privacy obligations, backup architecture, or what "restore" actually means in an append-only vs mutable database.

### The Fix

**Three-tier deletion model:**

```
Tier 1 — Org Admin soft delete
  → Data marked deleted, hidden from org dashboard
  → Retained for 30 days (configurable)
  → Org admin can self-restore within window

Tier 2 — Org Admin hard delete request
  → Data flagged for permanent deletion
  → 7-day grace period before execution
  → Super admin can cancel during grace period
  → After execution: unrecoverable (GDPR compliance)

Tier 3 — Super admin restore
  → Only available during Tier 1 or Tier 2 grace window
  → Super admin does NOT see raw data to perform restore
  → Restore is a metadata operation: flip deleted_at = NULL
```

**Key point on GDPR:** If you have customers in the EU or handle EU citizen data, a data subject can request permanent deletion. You must be able to execute a hard delete that bypasses even the super admin restore capability. Build this distinction now, not later.

**Backup architecture:**

Soft delete is not a backup. You need:
- Daily automated DB snapshots (retained 90 days)
- Point-in-time recovery (PITR) enabled on Postgres
- Snapshots stored in a separate account/region from production

Super admin restore from a genuine data loss event (not soft delete) comes from these backups, not from a `deleted_at` flag.

---

## 8. Medium — WiFi Telemetry Design

### What Was Wrong

The `WiFi Status` event was being logged continuously rather than on transitions. This generates noise that buries real events.

### The Fix

**Emit transition events only:**

```json
{
  "event_type": "NETWORK_CHANGED",
  "previous": {
    "ssid": "Office-WiFi",
    "bssid": "aa:bb:cc:11:22:33",
    "adapter": "Intel Wi-Fi 6 AX200"
  },
  "current": {
    "ssid": "MobileHotspot",
    "bssid": "ff:ee:dd:cc:bb:aa",
    "adapter": "Intel Wi-Fi 6 AX200"
  },
  "change_detected_after_restart": false,
  "captured_at": "2026-05-18T10:00:00Z"
}
```

**Recommended agent SQLite state for WiFi:**

```sql
CREATE TABLE network_state (
    adapter         TEXT NOT NULL,
    last_ssid       TEXT,
    last_bssid      TEXT,
    last_seen_at    INTEGER NOT NULL,  -- unix timestamp
    PRIMARY KEY (adapter)
);
```

Storing per-adapter means if a machine has both Ethernet and Wi-Fi, you track them independently.

---

## 9. Low — Deployment Architecture Clarity

### What Was Wrong

The original response jumped to Docker, Helm, and Kubernetes before the enrollment flow was solidified. This creates an illusion of maturity without foundation.

### The Correct Progression

**Stage 1 (Now):** Multi-tenant SaaS. Single backend. All orgs logically isolated by `org_id` and RLS. MSI installs agent with backend URL + enrollment token.

**Stage 2 (When you have paying enterprise clients):** Dedicated deployments via Docker Compose. You ship:
- `docker-compose.yml` referencing your private registry images
- Customer provides the server, you provide the compiled artifacts
- No source code, no `.env` files, no git access

**Stage 3 (Scale):** Helm charts + Kubernetes. CI/CD pipeline (GitHub Actions) builds and publishes versioned images automatically.

Do not build Stage 2 or 3 until Stage 1 is production-stable.

---

## 10. Proposed DB Schema (Full)

```sql
-- =============================================
-- PLATFORM LAYER
-- =============================================

CREATE TABLE organizations (
    org_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',  -- active, suspended, deleted
    max_agents      INTEGER,
    retention_days  INTEGER NOT NULL DEFAULT 90,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

-- =============================================
-- ENROLLMENT
-- =============================================

CREATE TABLE enrollment_tokens (
    token_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(org_id),
    token_hash      TEXT NOT NULL UNIQUE,   -- SHA256 of raw token, never store raw
    max_agents      INTEGER,
    expires_at      TIMESTAMPTZ,
    revoked         BOOLEAN NOT NULL DEFAULT false,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrollment_rules (
    rule_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id        UUID NOT NULL REFERENCES enrollment_tokens(token_id),
    rule_type       TEXT NOT NULL,   -- 'os_type', 'ip_range', 'geo_country'
    rule_value      TEXT NOT NULL
);

CREATE TABLE enrollment_attempts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id        UUID REFERENCES enrollment_tokens(token_id),
    machine_fingerprint TEXT,
    ip_address      INET,
    geo_country     TEXT,
    os_type         TEXT,
    outcome         TEXT NOT NULL,
    -- 'enrolled' | 'rejected_max' | 'rejected_ip' | 'rejected_os'
    -- 'rejected_expired' | 'rejected_revoked' | 'rejected_fingerprint'
    attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- AGENTS
-- =============================================

CREATE TABLE agents (
    agent_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id              UUID NOT NULL REFERENCES organizations(org_id),
    token_id            UUID REFERENCES enrollment_tokens(token_id),
    machine_fingerprint TEXT NOT NULL,
    hostname            TEXT,
    os_type             TEXT NOT NULL,   -- windows, mac, linux
    os_version          TEXT,
    agent_version       TEXT NOT NULL,
    ip_address          INET,
    enrolled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen           TIMESTAMPTZ,
    status              TEXT NOT NULL DEFAULT 'active',  -- active, inactive, revoked

    UNIQUE(token_id, machine_fingerprint)
);

-- RLS
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON agents
    USING (org_id = current_setting('app.current_org_id')::uuid);

-- =============================================
-- TELEMETRY
-- =============================================

CREATE TABLE telemetry_events (
    event_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(org_id),
    agent_id        UUID NOT NULL REFERENCES agents(agent_id),
    event_type      TEXT NOT NULL,
    payload         JSONB NOT NULL,
    observed        BOOLEAN NOT NULL DEFAULT true,  -- false = inferred/reconstructed
    captured_at     TIMESTAMPTZ NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ
);

ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON telemetry_events
    USING (org_id = current_setting('app.current_org_id')::uuid);

CREATE INDEX idx_telemetry_org_agent ON telemetry_events(org_id, agent_id);
CREATE INDEX idx_telemetry_type ON telemetry_events(event_type);
CREATE INDEX idx_telemetry_captured ON telemetry_events(captured_at DESC);

-- =============================================
-- USERS & ROLES
-- =============================================

CREATE TABLE users (
    user_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL,
    -- 'platform_owner' | 'org_admin' | 'org_viewer'
    org_id          UUID REFERENCES organizations(org_id),
    -- NULL for platform_owner, required for org roles
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login      TIMESTAMPTZ
);

-- =============================================
-- DATA DELETION TRACKING
-- =============================================

CREATE TABLE deletion_requests (
    request_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id          UUID NOT NULL REFERENCES organizations(org_id),
    requested_by    UUID NOT NULL REFERENCES users(user_id),
    tier            INTEGER NOT NULL,  -- 1 (soft), 2 (hard)
    grace_until     TIMESTAMPTZ,
    executed_at     TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,
    cancelled_by    UUID REFERENCES users(user_id)
);
```

---

## 11. Enrollment Flow (Corrected End-to-End)

```
SUPER ADMIN
  └─ Creates organization in platform dashboard
       └─ org_id generated
       └─ Creates enrollment token
            └─ Sets rules: max_agents=10000, os=windows, expires=+72h
            └─ token_hash stored (never raw token)
            └─ Raw token sent to org admin once

ORG ADMIN
  └─ Receives token out-of-band (email / secure channel)
  └─ Deploys via GPO / Intune:
       msiexec /i RAVAgent.msi BACKEND_URL=https://api.yourplatform.com ENROLL_TOKEN=RAV-XXXX /qn

AGENT (first run)
  └─ Reads ENROLL_TOKEN from registry / config file
  └─ Builds machine fingerprint:
       SHA256(motherboard_serial + cpu_id + disk_serial + mac_address)
  └─ POST /enroll
       { token: "RAV-XXXX", fingerprint: "sha256:...", hostname: "...", os: "windows" }

BACKEND
  └─ Hash token → look up enrollment_tokens
  └─ Check: not revoked, not expired
  └─ Check rules: os_type, ip_range, geo_country
  └─ Check: current enrolled count < max_agents
  └─ Check UNIQUE(token_id, fingerprint):
       - Already exists → return existing agent_id (reinstall case)
       - New → INSERT agent record
  └─ Generate agent_id + issue short-lived JWT
  └─ Log enrollment_attempt with outcome

AGENT (after enrollment)
  └─ Stores agent_id + JWT
  └─ Deletes enrollment token from local storage
  └─ Authenticates all future requests with agent_id + JWT
  └─ Enrollment token is no longer needed or used
```

---

## 12. Super Admin Dashboard — What to Show

### Platform View (default, no org selected)

| Column | Source | Notes |
|--------|--------|-------|
| Org Name | `organizations.name` | Clickable |
| Agent Count | `COUNT(agents)` | Active only |
| Status | Derived | Healthy / Warning / Critical |
| Last Activity | `MAX(agents.last_seen)` | |
| Enrollment Alerts | `enrollment_attempts` with rejected outcome | ⚠ badge if > 0 in last 24h |
| Created | `organizations.created_at` | |

**No hostnames. No IPs. No telemetry. No user data.**

### Org-Scoped View (after clicking into org)

Always show banner: **`[Platform Owner → Viewing: Acme Corp]`**

Tabs available:
- **Agents** — full agent list, status, last seen, version
- **Telemetry** — filterable event feed
- **Enrollment** — token status, rules, attempt log
- **Settings** — retention policy, max agents, suspension
- **Danger Zone** — restore deleted data (within window), revoke all agents

### Telemetry Page Filters (fix for the design question raised)

- **Time range:** Last 1h / 6h / 24h / 7d / 30d / Custom
- **Event type:** Multi-select (NETWORK_CHANGED, AGENT_OFFLINE_PERIOD, etc.)
- **Agent:** Search by hostname or agent_id
- **Observed only:** Toggle to exclude inferred/reconstructed events
- **OS type:** Windows / Mac / Linux

For long timelines: paginate by 100 events. Do not render all events in a single list. Add a summary bar chart at the top showing event volume over time so the admin can identify spikes before drilling down.

---

*End of FIXES.md*
