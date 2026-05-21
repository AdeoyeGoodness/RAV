# Agent auto-update (MSI-based)

The agent updates itself from the server. No per-endpoint reinstall after the first rollout.

## How it works

1. Every heartbeat (`POST /api/v1/agents/heartbeat`) the backend reads
   `backend/storage/agent/latest.json` and, if present, returns an `update` block:
   ```json
   { "status": "success", "update": { "version": "0.1.4", "sha256": "<hex>", "url": "/api/v1/agent/download" } }
   ```
2. The agent (`agent/src/update.rs`) compares the advertised **agent semver** to its own
   `CARGO_PKG_VERSION`. If newer, it downloads the MSI from `/api/v1/agent/download`, verifies
   the SHA-256, writes it to `C:\ProgramData\RAV\update\RAVAgent.msi`, and launches:
   ```
   msiexec /i RAVAgent.msi /qn /norestart REBOOT=ReallySuppress WIXUI_EXITDIALOGOPTIONALCHECKBOX=0
   ```
3. Windows Installer (out-of-process) runs the WiX `MajorUpgrade`: **stops** the RAVAgent
   service, replaces every installed file (exe + extension + registry + native host), and
   **restarts** it. Fully unattended — no prompt, no reboot. The agent comes back on the new
   version a moment later; the next heartbeat advertises the same version, so it stops updating.

Self-healing guards: only one update runs at a time; a given version isn't retried for 30 min
(so a publish mistake can't cause a download loop); stale installers are cleared on startup.

## Two version numbers — bump BOTH every release

| Number | Where | Used by | Rule |
|--------|-------|---------|------|
| Agent semver | `agent/Cargo.toml` `version` + `latest.json` `version` | the agent's "am I behind?" check | must increase |
| MSI ProductVersion | `agent-wix/Product.wxs` `<Package Version=...>` | `msiexec` MajorUpgrade decision | must increase **and stay ≥ the installed one** |

They don't need to match numerically, but **both must go up**. The MSI version can't go
*down* (currently `1.0.1.0`; never publish a lower one — MajorUpgrade refuses downgrades).

Current release: agent **0.1.3**, MSI **1.0.1.0** (this is the build that introduces
auto-update).

## Bootstrap caveat (read once)

Agents older than 0.1.3 have **no** auto-update code, so they can't pull 0.1.3 themselves. The
**0.1.3 build must be deployed once via the normal MSI install/reinstall**. From 0.1.3 onward,
every later version (0.1.4, …) rolls out automatically.

## Publishing a new version

On a build machine (Windows, for the MSI):

```powershell
# 1. Bump versions
#    agent/Cargo.toml         version = "0.1.4"
#    agent-wix/Product.wxs     Version="1.0.2.0"

# 2. Build the agent, then the MSI (your existing agent-wix build step)
cargo build --release --manifest-path agent\Cargo.toml
#    ...build agent-wix -> agent-wix\output\RAVAgent.msi
```

On the RAV server (`~/RAV/backend`):

```bash
mkdir -p storage/agent
cp /path/to/RAVAgent.msi storage/agent/RAVAgent.msi

HASH=$(sha256sum storage/agent/RAVAgent.msi | awk '{print $1}')
cat > storage/agent/latest.json <<EOF
{ "version": "0.1.4", "sha256": "$HASH", "filename": "RAVAgent.msi" }
EOF
```

`version` here is the **agent semver** you set in `Cargo.toml`. No backend restart needed — the
manifest is read per-heartbeat. To pause/disable rollout, delete or rename `latest.json`.

## Verify end-to-end (test VPS)

1. Confirm the server serves it: `curl -I http://<server>/api/v1/agent/download` → 200,
   `Content-Type: application/octet-stream`.
2. On a test endpoint already running ≥0.1.3, watch the log:
   ```powershell
   $log = (gci C:\ProgramData\RAV\logs\* | sort LastWriteTime -desc | select -First 1).FullName
   Get-Content $log -Tail 30 -Wait
   ```
   Expect: `Auto-update: 0.1.3 -> 0.1.4 available; downloading installer` → `sha256 verified`
   → `msiexec launched ...`. The service blips and returns.
3. Confirm the new version: `Get-Service RAVAgent` running, and the next startup log line shows
   `RAV Agent starting (v0.1.4)`.

## Security (important, currently deferred hardening)

Over plain HTTP this is effectively **SYSTEM-level remote code delivery** from the backend: any
party that controls the server or can MITM the LAN can push an arbitrary MSI to every endpoint.
The SHA-256 check only catches corruption (the hash arrives over the same channel). Harden with:
- **TLS** on the backend (the standing "No TLS" item in `PRODUCTION_SETUP.md`), and
- an **Authenticode-signed MSI** with signature verification before launch.
Acceptable for now only because the network is internal/firewalled.
