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
*down* (currently `1.0.5.0`; never publish a lower one — MajorUpgrade refuses downgrades).

Current release: agent **0.1.7**, MSI **1.0.5.0** (fixes the Interrogate-driven service
shutdown that took machines offline, and adds service failure-recovery / crash auto-restart).

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

## Signing (provenance hardening — strongly recommended)

Auto-update is effectively remote SYSTEM code delivery. The sha256 alone does **not** stop a
hostile server / LAN MITM (they'd control the manifest hash too). The real defense is an
**Authenticode-signed MSI** the agent verifies before running. The agent already enforces this
when `backend.update_signer_thumbprint` is set; here's the one-time setup. (Until it's set, the
agent logs a warning and falls back to sha256-only, so nothing breaks before you finish.)

### 1. Create a code-signing cert — once, on the build machine (free, self-signed)
```powershell
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=RAV Agent Updates" `
        -CertStoreLocation Cert:\CurrentUser\My -KeyExportPolicy Exportable -KeyLength 2048 `
        -NotAfter (Get-Date).AddYears(10)
$cert.Thumbprint                                   # -> the value for update_signer_thumbprint

$pw = ConvertTo-SecureString "STRONG-PASSWORD" -AsPlainText -Force
Export-PfxCertificate -Cert $cert -FilePath rav-signing.pfx -Password $pw   # SECRET (build box only)
Export-Certificate    -Cert $cert -FilePath rav-signing.cer                  # public (push to endpoints)
```

### 2. Sign the MSI — every release (signtool ships with the Windows SDK / VS Build Tools)
```powershell
signtool sign /fd SHA256 /f rav-signing.pfx /p "STRONG-PASSWORD" /d "RAV Agent" RAVAgent.msi
# optional, if the build box has internet (keeps signature valid past cert expiry):
#   ... /tr http://timestamp.digicert.com /td SHA256 ...
signtool verify /pa RAVAgent.msi                   # sanity check
```

### 3. Trust the cert on endpoints (so Authenticode status is `Valid`)
Pick one:
- per endpoint (admin):
  ```powershell
  Import-Certificate -FilePath rav-signing.cer -CertStoreLocation Cert:\LocalMachine\Root
  Import-Certificate -FilePath rav-signing.cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher
  ```
- fleet: push `rav-signing.cer` to Trusted Root via GPO, or bake it into the MSI.

### 4. Turn on enforcement
Set the thumbprint (no spaces) either in each `C:\ProgramData\RAV\config.toml` under `[backend]`:
```
update_signer_thumbprint = "<thumbprint>"
```
(then `Restart-Service RAVAgent`) — or hard-pin it in the binary via `DEFAULT_SIGNER_THUMBPRINT`
in `agent/src/update.rs` and rebuild (tamper-proof, but a rebuild is needed to rotate). Config is
the low-stress option and is safe against the network threat model (a remote attacker can't edit a
local file).

After this, an attacker who controls the server or the wire still can't push a malicious update —
they can't produce an MSI signed by your key.

## Still deferred: TLS

This adds *signing* (provenance). It does **not** encrypt traffic — screenshots/evidence and JWT
cookies still travel as plain HTTP on the internal LAN. TLS is a separate, higher-effort task
(IP-only net → self-signed/internal CA, plus a URL-scheme change rippling through the agent config,
dashboard rebuild, and CORS). Tracked as the standing "No TLS" item in `PRODUCTION_SETUP.md`.
