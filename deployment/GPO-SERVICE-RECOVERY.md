# Central service recovery via Group Policy (or Intune)

This sets up a fleet-wide safety net that keeps the RAV Monitoring Agent service
running, managed centrally by IT and independent of the agent's own local watchdog.
It is **service-reliability only** — it restarts a stopped service and reinstates a
removed agent through the normal software-deployment channel. It never disables any
security protection and never fights the endpoint's own AV.

There are three recovery layers, strongest-to-last-resort:

| Layer | Handles | Mechanism |
|---|---|---|
| SCM auto-restart | Service crash | `util:ServiceConfig` in the MSI (restart on failure) |
| Local watchdog | Service cleanly Stopped / killed | Scheduled task `RAV Monitoring Agent Watchdog`, every 2 min (installed by MSI) |
| **This GPO task** | Service Stopped on boxes where the local task was removed | `ensure-rav-service.ps1` pushed by Group Policy, every N min as SYSTEM |
| Central redeploy | Agent binary deleted/uninstalled | Signed MSI assigned as a **required** app (Intune) or GPO software install — reinstalls on the next policy cycle |

## A. Push `ensure-rav-service.ps1` as a scheduled task (Group Policy Preferences)

1. Copy `ensure-rav-service.ps1` to a read-only network share all machines can reach,
   e.g. `\\<server>\NETLOGON\RAV\ensure-rav-service.ps1`.
2. Open **Group Policy Management**, create/edit a GPO linked to the OU holding the
   endpoints, e.g. "RAV - Service Recovery".
3. Go to **Computer Configuration > Preferences > Control Panel Settings > Scheduled
   Tasks**. New > **Scheduled Task (At least Windows 7)**.
4. Configure:
   - **Action:** Update (idempotent — creates or updates).
   - **Name:** `RAV Service Recovery`.
   - **Run as:** `NT AUTHORITY\SYSTEM`, **Run with highest privileges**, run whether
     or not a user is logged on.
   - **Trigger:** Repeat task every **5 minutes** (or your chosen N), indefinitely;
     also "At startup".
   - **Action:** Start a program ->
     `powershell.exe`
     arguments:
     `-NonInteractive -ExecutionPolicy Bypass -File "\\<server>\NETLOGON\RAV\ensure-rav-service.ps1"`
5. Apply. Boxes pick it up on the next Group Policy refresh (~90-120 min, or at next
   reboot, or immediately with `gpupdate /force`).

## B. Reinstate a removed agent (central redeploy)

The scripts deliberately do **not** re-create a deleted binary. To make a removed
agent come back on its own:

- **Intune:** add the signed `RAVAgent.msi` as a **Required** Win32/line-of-business
  app assigned to the device group. Intune re-evaluates the detection rule on each
  check-in and reinstalls if the agent is missing.
- **Group Policy software installation:** assign `RAVAgent.msi` (Computer
  Configuration > Policies > Software Settings > Software installation). Assigned
  packages are re-advertised and self-heal on the policy cycle.

On a box with **Smart App Control** enforcing, deploying through Intune/GPO like this
is also what lets the signed MSI install cleanly in the first place — see
`SIGNING-AND-CLEAN-INSTALL.md`. We never disable SAC/Defender to make it install.

## Verifying

1. On a test box in the OU, `gpupdate /force`, then confirm the `RAV Service Recovery`
   task exists (`schtasks /query /tn "RAV Service Recovery"`).
2. `Stop-Service AssetTelemetryService`; within the task interval it restarts, and an
   Application event-log entry (source "RAV Monitoring Agent") records it.
3. Remove the local `RAV Monitoring Agent Watchdog` task and repeat — the GPO task
   still recovers the service (the layers are independent).
4. Uninstall the agent entirely and confirm the Intune/GPO required-app assignment
   reinstalls it on the next policy cycle.
