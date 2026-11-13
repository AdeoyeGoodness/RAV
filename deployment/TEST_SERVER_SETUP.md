# Test server + transparent-agent upgrade test

Purpose: validate the transparent agent build (2.0.2.0 — honest naming, `RavMonitor.exe`,
tray indicator, ACL hardening, no Defender exclusions) and especially the **rename
major-upgrade** on a throwaway server before it ever touches the production fleet.

The agent/MSI changes carry one real risk: the exe + install-dir rename takes effect as
an MSI major-upgrade on already-enrolled boxes. This test proves an existing agent
upgrades in place and keeps reporting (same agent id, identity preserved).

---

## 1. Stand up the test server

It is a clean replica of production (`deployment/PRODUCTION_SETUP.md` §5). Everything is
the same except the server's address. Let `TEST_ADDR` = the test server's reachable
address (IP or host, e.g. `http://203.0.113.10` or `http://rav-test.example.com`).

> **Skip MinIO.** The current backend does NOT use S3/MinIO — the `aws-sdk-s3`
> dependency is commented out in `backend/Cargo.toml` ("enable in Phase 2"), and every
> file handler reads/writes the local filesystem under `~/RAV/backend/storage/`
> (`files/`, `archives/`). The `S3_*` env vars are read into config but never used to
> connect. So you do NOT need the `minio` server, the `mc` client, or a bucket — and
> MinIO community binaries are no longer downloadable anyway (dl.min.io returns 410,
> Docker Hub/quay are gone/gated). Ignore the MinIO steps; the `/minio/` and `/console/`
> nginx routes are harmless no-ops. Screenshots and archives just land on local disk.

Change these from the prod doc to `TEST_ADDR`:

| File / place | Value | Set to |
|---|---|---|
| `~/RAV/backend/.env` | `S3_ENDPOINT` | `TEST_ADDR/minio` |
| `~/RAV/backend/.env` | `CORS_ALLOWED_ORIGINS` | `TEST_ADDR` |
| `/etc/default/minio` | `MINIO_SERVER_URL` | `TEST_ADDR/minio` |
| `/etc/default/minio` | `MINIO_BROWSER_REDIRECT_URL` | `TEST_ADDR/console` |
| nginx `deployment/nginx-rav.conf` | `server_name` + `allow` list | the test host / the network the test endpoints are on |

Leave `~/RAV/dashboard/.env.local` **empty / `NEXT_PUBLIC_API_URL=`** — the dashboard is
same-origin, so it works on any host without a rebuild tied to the address.

`S3_ACCESS_KEY == MINIO_ROOT_USER` and `S3_SECRET_KEY == MINIO_ROOT_PASSWORD` must still
match (the prod doc's credential-coupling rule).

Then: `pm2 start ecosystem.config.js`, build+migrate the backend, build the dashboard,
install nginx, create the first admin (prod doc §6). Smoke test (prod doc §7).

Create an **organization** and an **enrollment token** in the dashboard — you'll need
the token for the agent installs below.

---

## 2. Two MSIs for the upgrade test

Both are in `agent-wix/output/` after the local build:

- **OLD** (pre-rename, 2.0.1.0): `RAVAgent-2.0.1-old-asset-telemetry.msi` — simulates a
  box already in the field ("Asset Telemetry Service" / `AssetTelemetry.exe`).
- **NEW** (transparent, 2.0.2.0): `RAVAgent.msi` — the build under test.

Both are universal: the server is chosen at install via `BACKEND_URL`.

---

## 3. The upgrade test (the important part)

On a **clean Windows test endpoint** that can reach `TEST_ADDR` (prove it first:
`curl.exe -i --max-time 10 TEST_ADDR/api/v1/agents` must return `401`):

### Step A — install the OLD agent and let it enroll
```powershell
Remove-Item -Recurse -Force C:\ProgramData\RAV -ErrorAction SilentlyContinue
msiexec /i RAVAgent-2.0.1-old-asset-telemetry.msi BACKEND_URL="TEST_ADDR" ENROLLMENT_TOKEN="<token>" /qn
```
Confirm:
- Service exists: `Get-Service AssetTelemetryService` → Running.
- It shows in the dashboard and reports events. **Note its agent id / device row.**
- (Baseline) Task Manager shows `AssetTelemetry.exe`; install dir is `C:\Program Files\Asset Telemetry`.

### Step B — install the NEW agent OVER it (the major upgrade)
```powershell
msiexec /i RAVAgent.msi /qn
```
(No need to re-pass BACKEND_URL/token — identity is preserved in `identity.toml`; the
box stays enrolled.)

Confirm the rename took **and continuity held**:
- `Get-Service AssetTelemetryService` → still exists, Running (internal key unchanged on purpose).
- `services.msc` DisplayName is now **"RAV Monitoring Agent"** with the honest description.
- Task Manager now shows **`RavMonitor.exe`**; install dir is `C:\Program Files\RAV Monitoring Agent`; the old `Asset Telemetry` folder is gone.
- The dashboard shows the **same device/agent id** still reporting (no duplicate, no orphan).
- **Tray indicator**: log in as a normal user → a shield icon appears in the system tray with the "this device is monitored" tooltip, and the one-time notice appears once.
- Watchdog task renamed: `schtasks /query /tn "RAV Monitoring Agent Watchdog"` exists at a 2-minute interval; the old `Asset Telemetry Watchdog` is gone.
- **No AV evasion**: `Get-MpPreference | Select ExclusionPath, ExclusionProcess` shows **no** RAV entries.
- **ACL hardening**: a standard (non-admin) user cannot delete files under `C:\ProgramData\RAV`, and `C:\ProgramData\RAV\logs` is not readable by that user.

### Step C — recovery
```powershell
Stop-Service AssetTelemetryService
# within ~2 min the watchdog restarts it; dashboard shows Stopped -> Running
```

### Step D — clean-install sanity (optional)
On a second clean box, install only the NEW MSI and confirm it enrolls, reports, shows
the indicator, and (once you have a signing cert) installs without any Defender prompt.

---

## 4. If anything fails

- Upgrade didn't replace the old service/exe, or the device duplicated → capture
  `C:\ProgramData\RAV\logs\agent.log` and the `services.msc` state; do **not** roll this
  to production. The internal service key and both watchdog paths were kept stable
  specifically to avoid this — a failure here is a bug to fix, not to ship around.
- Agent stopped reporting after upgrade → check `type C:\ProgramData\RAV\config.toml`
  (`[backend] url` must be `TEST_ADDR`) and `identity.toml` (agent_id/org preserved).

Only after Steps A–C pass cleanly on the test server should the signed 2.0.2.0 MSI be
rolled to the production fleet.
