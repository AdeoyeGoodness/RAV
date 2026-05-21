# Browser extension — self-hosted force-install (no public store)

The RAV browser extension installs automatically on managed endpoints from **our own backend** —
no Chrome/Edge Web Store, no internet. This works on the internal/offline network.

## How it works

1. The MSI writes an enterprise force-install policy (HKLM) for Chrome **and** Edge:
   ```
   ExtensionInstallForcelist\1 = fammadlbpgjlmfacjgcbabjohgknacib;<BACKEND_URL>/api/v1/extension/updates.xml
   ExtensionInstallAllowlist\1 = fammadlbpgjlmfacjgcbabjohgknacib
   ```
   `<BACKEND_URL>` is the install-time server (e.g. `http://172.16.100.41`).
2. The browser fetches the **update manifest** from the backend
   (`GET /api/v1/extension/updates.xml`), which points at the **signed CRX**
   (`GET /api/v1/extension/download`).
3. The browser installs/keeps the extension. Its ID (`fammadlbpgjlmfacjgcbabjohgknacib`) matches the
   manifest `key`, the CRX signing key, and the agent's native-messaging `allowed_origins`, so the
   extension can talk to the agent over native messaging.

The extension ID is fixed by the signing key **`agent-wix/rav-extension.pem`**. This key is
**gitignored (`*.pem`) — it is NOT in the repo** — so keep it safe on the build machine and back it
up; losing it changes the ID and breaks the fleet. Changing the key changes the ID, and then
`manifest.json` "key", `native-messaging-host.json`, `Product.wxs`, and `EXTENSION_ID` in the
backend must all be updated together.

## Build (produces the CRX)

`agent-wix/build-msi.ps1` now does it automatically: builds the extension, then
`npm run pack-crx` → `agent-wix/output/rav.crx` (signed, stable ID). To pack manually:
```powershell
cd extension; npm run build; npm run pack-crx   # -> ../agent-wix/output/rav.crx
```

## Publish to the backend (one copy step, like the agent MSI)

```bash
cd ~/RAV/backend && mkdir -p storage/extension
cp /path/to/rav.crx storage/extension/rav.crx
# Optional: pin the advertised version (must equal manifest.json "version"; default 1.0.0)
echo "1.0.0" > storage/extension/version
```
No backend restart needed — the manifest is generated per request. To pause rollout, remove
`storage/extension/rav.crx` (the update check then 404s and browsers keep what they have).

## Verify (on a managed endpoint)

1. Backend serves it:
   ```
   curl http://172.16.100.41/api/v1/extension/updates.xml      # XML with codebase + version
   curl -I http://172.16.100.41/api/v1/extension/download      # 200, app/x-chrome-extension
   ```
2. `edge://policy` (or `chrome://policy`) → `ExtensionInstallForcelist` shows the **new ID** and the
   **`/api/v1/extension/updates.xml`** URL (not the store). Click "Reload policies".
3. `edge://extensions` → "RAV Browser Monitor" appears, **installed by enterprise policy**, ID
   `fammadlbpgjlmfacjgcbabjohgknacib`. (May take a couple minutes / a browser restart.)
4. The agent log shows native-messaging connections from the extension.

## Updating the extension later

Bump `extension/manifest.json` `version`, rebuild (`build-msi.ps1` repacks the CRX), republish
`rav.crx` to `storage/extension/`, and set `storage/extension/version` to the new value. Browsers
poll the update manifest periodically and upgrade themselves — no MSI reinstall needed (the policy
already points at the backend). The ID never changes (same signing key).

## Note
Force-install over plain HTTP on an internal LAN is acceptable here; the CRX is signed so the
browser verifies its integrity + ID. Same TLS caveat as the rest of the stack.
