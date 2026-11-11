# Signing & clean install (no disabling protections)

The RAV Monitoring Agent is an openly-identified, code-signed monitoring agent. It
installs cleanly on a normally-protected Windows box. **We never tell an operator to
turn off Microsoft Defender, Tamper Protection, SmartScreen, or Smart App Control**,
and the installer no longer adds any Defender exclusions. Clean install comes from a
valid Authenticode signature plus, where Smart App Control is enforcing, deployment
through a managed channel.

## 1. Get a code-signing certificate

You (the owner) must obtain an Authenticode code-signing certificate. Options, from
cheapest-clean to strongest:

| Option | What it buys | Notes |
|---|---|---|
| **OV (standard) cert** | Removes the "unknown publisher" warning; SmartScreen reputation builds up over time/volume | Cheapest. Early installs may still show a SmartScreen prompt until reputation accrues. |
| **EV cert** | Immediate SmartScreen reputation | Private key must live on approved hardware/HSM. |
| **Azure Trusted Signing** | Immediate reputation, cloud-managed signing, low cost | Microsoft-run signing service; good fit if you don't want to manage a key. |

Record the certificate's **SHA-1 thumbprint** (no spaces) — the build and the
auto-update check both use it.

## 2. Sign at build time

`agent-wix/build-msi.ps1` signs both the agent exe (before it is packaged, so the
copy inside the MSI cab is trusted) and the finished MSI:

```powershell
# Thumbprint can be passed or set once as an env var (RAV_SIGN_THUMBPRINT).
powershell -ExecutionPolicy Bypass -File agent-wix\build-msi.ps1 -CertThumbprint <SHA1-THUMBPRINT>
```

Without a thumbprint the build still produces an MSI but it is **unsigned** and the
script warns loudly. Never ship the unsigned artifact to endpoints with protections
on — it will be flagged by Defender/SmartScreen and blocked by Smart App Control.

`signtool.exe` must be available (install the Windows SDK). The script finds it on
`PATH` or under the Windows Kits folder automatically.

## 3. Enforce signed auto-updates

The agent can refuse any downloaded update MSI that isn't signed by your cert. After
you have a cert, pin its thumbprint one of two ways:

- **Config:** set `backend.update_signer_thumbprint` in `config.template.toml`
  (currently commented out), or
- **Compiled-in:** set `DEFAULT_SIGNER_THUMBPRINT` in `agent/src/update.rs`.

With the thumbprint set, `update.rs` validates the installer's Authenticode signature
(status Valid + signer thumbprint match) before running it; a wrong-signer or unsigned
MSI is rejected. With it empty, only the SHA-256 hash is checked (enforcement off).

## 4. Smart App Control (SAC) boxes

SAC is stricter than Defender/SmartScreen: it blocks software whose publisher has not
yet established reputation with Microsoft, **even when the signature is valid**. There
is no way to make an arbitrary signed binary pass SAC on day one, and we do **not**
work around it by disabling anything.

The reliable clean-install path on SAC-enforcing machines is **managed deployment**:
push the signed MSI as a *required* app via **Microsoft Intune** or **Group Policy
software installation**. Deployed through the management channel, the agent installs
without SAC blocking it, and the same channel re-applies it if it is ever removed
(see `GPO-SERVICE-RECOVERY.md`). For a company's own managed fleet this is the normal
route and it lines up with how the rest of the fleet is managed.

EV / Azure Trusted Signing also accelerate SAC/SmartScreen reputation and are worth it
if you deploy outside a managed channel.

## Summary

1. Buy an OV (or EV / Azure Trusted Signing) cert; note its SHA-1 thumbprint.
2. Build with `-CertThumbprint` so the exe and MSI are signed.
3. Pin the thumbprint to enforce signed auto-updates.
4. On Smart App Control boxes, deploy via Intune/GPO — never by turning off a protection.
