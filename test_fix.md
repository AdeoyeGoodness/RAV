# 🕵️‍♂️ RAV Enterprise Features: Verification Guide

Follow these steps to verify the advanced stealth, security, and persistence features implemented in the RAV Agent.

---

## 1. Stealth & Hidden Attributes (Item 5.3)
**Goal:** Ensure agent files are invisible to standard users.
1. **Action:** Open `C:\ProgramData\RAV` in File Explorer.
2. **Check:** The folder should look empty even if "Hidden items" is checked in the "View" tab.
3. **Deep Check:** Open a Command Prompt and type: `dir /a` in that directory. You should see `config.toml`, `rav_events.db`, and `logs/` marked with `H` (Hidden) and `S` (System).

## 2. Windows Service Obfuscation (Item 5.1 & 5.2)
**Goal:** Masquerade as a legitimate system component.
1. **Action:** Re-install the agent with a custom name:
   ```cmd
   rav-agent.exe --install --service-name "WindowsSecurityAssist" --display-name "Windows Security Assistant Service"
   ```
2. **Check:** Open `services.msc`. Look for "Windows Security Assistant Service".
3. **Verify:** Right-click -> Properties. It should point to the RAV executable, but the service name in the system is completely custom.

## 3. DPAPI Key Protection (Item 10.2)
**Goal:** Ensure keys are locked to the specific machine.
1. **Check:** The `encryption.key` file in `C:\ProgramData\RAV` is now encrypted using your Windows Account credentials.
2. **Test:** If you try to copy this file to a different computer and replace its key, the agent will fail to start because it cannot "unseal" the key.

## 4. Forensics Export Tool (Item 7.1)
**Goal:** Extract data even when offline.
1. **Action:** Run the export command:
   ```cmd
   rav-agent.exe --export forensics_dump.json
   ```
2. **Check:** Open `forensics_dump.json`. You should see a full list of all historical events (USB, Network, etc.) in a structured JSON format.

## 5. Self-Healing Watchdog (Item 8.2)
**Goal:** Continuous monitoring resiliency.
1. **Check Logs:** Open `C:\ProgramData\RAV\logs\agent.log`.
2. **Simulate Crash:** If a monitoring module encounters an error, look for entries saying: `"[MODULE] module CRASHED... Restarting in 10s"`.
3. **Verify:** The agent will automatically re-spawn the monitoring task without a service restart.

## 6. Network Jitter (Item 5.5)
**Goal:** Break robotic traffic patterns.
1. **Action:** Monitor your dashboard "Last Seen" or use Wireshark.
2. **Check:** You will notice the heartbeats do not arrive at exactly 60.0s intervals. They will arrive at 63s, 58s, 67s, etc.

## 7. Tamper Detection (Item 5.7)
**Goal:** Alert if someone messes with the agent.
1. **Action:** While the agent is running, manually delete the service: `sc delete WindowsSecurityAssist` (or whatever name you used).
2. **Wait:** 60 seconds.
3. **Check Dashboard:** Look for a **CRITICAL** Audit Event saying: `"Local service tampering detected!"`.

---

## 9. Forensic Email Notifications (Item 12.4)
**Goal:** Automate admin alerts when forensic snapshots are ready.
1. **Configure SMTP:** Update your `.env` file with your mail server details:
   ```env
   SMTP_HOST=smtp.your-provider.com
   SMTP_PORT=587
   SMTP_USER=your-email@example.com
   SMTP_PASS=your-secure-password
   SMTP_FROM=rav-alerts@your-domain.com
   ```
2. **Action:** Trigger an archive (either via the 3-day background loop or the "Manual Archive" button).
3. **Verify:**
   - Check the `backend` terminal for logs: `Forensic archive notification dispatched to...`
   - Check the inbox for the admin account. You should receive an email with the subject: **RAV FORENSIC ALERT: Archive Ready (Agent ID)**.
   - Confirm the email states the "Burn After Reading" policy clearly.

---

## 🚀 How to build the Agent with these changes:
Run this from the `agent/` directory:
```powershell
cargo build --release
```
The binary will be at `agent/target/release/rav-agent.exe`.
