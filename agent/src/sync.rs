use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::time::Duration;
use tracing::{error, info, warn};

use crate::config::Config;
use crate::storage::StorageManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub agent_id: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heartbeat {
    pub agent_id: String,
    pub hardware_fingerprint: String,
    pub timestamp: DateTime<Utc>,
    pub version: String,
    pub hostname: Option<String>,
}

pub struct AgentIdentity {
    pub agent_id: Option<String>,
    pub organization_id: Option<String>,
}

/// Exponential backoff with ±5s jitter, capped at 600s.
/// 1 failure → 60s, 2 → 120s, 3 → 240s, 4 → 480s, 5+ → 600s.
fn compute_backoff_secs(failures: u32) -> u64 {
    use rand::Rng;
    let exp = failures.min(5);
    let base = (2u64.pow(exp)).saturating_mul(30).min(600);
    let jitter = rand::thread_rng().gen_range(0..5);
    base + jitter
}

#[derive(Clone)]
pub struct SyncManager {
    config: Arc<Config>,
    client: reqwest::Client,
    storage: Arc<StorageManager>,
    identity: Arc<tokio::sync::RwLock<AgentIdentity>>,
}

impl SyncManager {
    // Modified: Now takes Arc<StorageManager> dependency
    pub fn get_storage(&self) -> Arc<StorageManager> {
        self.storage.clone()
    }

    pub fn new(config: Arc<Config>, storage: Arc<StorageManager>) -> Result<Self> {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(false)
            .timeout(Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .context("Failed to create HTTP client")?;

        let initial_agent_id = config.agent.agent_id.clone();
        let initial_org_id = config.agent.organization_id.clone();

        Ok(Self {
            config,
            client,
            storage,
            identity: Arc::new(tokio::sync::RwLock::new(AgentIdentity {
                agent_id: initial_agent_id,
                organization_id: initial_org_id,
            })),
        })
    }

    pub async fn get_identity(&self) -> (String, String) {
        let id_guard = self.identity.read().await;
        (
            id_guard.agent_id.clone().unwrap_or_else(|| "unknown".to_string()),
            id_guard.organization_id.clone().unwrap_or_else(|| "unknown".to_string()),
        )
    }

    // New Behavior: Immediate Write to Disk (Store & Forward)
    pub fn queue_event(&self, event: Event) {
        if let Err(e) = self.storage.save_event(&event) {
            error!("CRITICAL: Failed to persist event to disk: {}", e);
        }
    }

    // Trigger immediate sync for important events
    pub async fn sync_events_immediate(&self) {
        if let Err(e) = self.sync_events().await {
            error!("Immediate sync error: {}", e);
        }
    }

    pub async fn persist_state(&self) -> Result<()> {
        info!("Checkpoint: Persisting global agent state...");
        // This is a hub call! Monitoring modules (USB, etc.) 
        // will use self.storage directly or through this manager.
        Ok(())
    }

    pub async fn audit_event(&self, message: &str, severity: &str) {
        let (agent_id, _) = self.get_identity().await;
        let event = Event {
            event_type: "audit_log".to_string(),
            timestamp: Utc::now(),
            agent_id,
            metadata: serde_json::json!({
                "message": message,
                "severity": severity,
                "category": "security_audit"
            }),
        };
        self.queue_event(event);
    }

    pub async fn run_sync_loop(&self) {
        let sync_interval = self.config.backend.sync_interval_seconds;
        let mut consecutive_failures: u32 = 0;
        let mut enrollment_failures: u32 = 0;
        let mut enrolled = false;

        loop {
            // Phase 1: enrollment. Retry with backoff until the backend accepts us.
            if !enrolled {
                match self.enroll_agent().await {
                    Ok(_) => {
                        info!("Agent session active");
                        self.audit_event("RAV Agent session started", "info").await;
                        enrollment_failures = 0;
                        enrolled = true;
                        // Fall through to the sync cadence below.
                    }
                    Err(e) => {
                        enrollment_failures = enrollment_failures.saturating_add(1);
                        let backoff = compute_backoff_secs(enrollment_failures);
                        error!(
                            "Failed to enroll agent (attempt {}): {}. Retrying in {}s.",
                            enrollment_failures, e, backoff
                        );
                        tokio::time::sleep(Duration::from_secs(backoff)).await;
                        continue;
                    }
                }
            }

            // Phase 2: normal sync cadence (with backoff on transient sync failures).
            let base_sleep = if consecutive_failures > 0 {
                compute_backoff_secs(consecutive_failures)
            } else {
                let jitter = {
                    use rand::Rng;
                    let mut rng = rand::thread_rng();
                    rng.gen_range(0..5)
                };
                sync_interval + jitter
            };
            tokio::time::sleep(Duration::from_secs(base_sleep)).await;

            // 1. Process Telemetry Events (Ordered by captured_at)
            match self.sync_events().await {
                Ok(_) => {
                    consecutive_failures = 0;
                }
                Err(e) => {
                    consecutive_failures = consecutive_failures.saturating_add(1);
                    error!("Sync cycle failed (attempt {}): {}", consecutive_failures, e);
                    continue; // Skip heartbeat if we can't even sync events
                }
            }

            // 2. Heartbeat (Health Check)
            if let Err(e) = self.send_heartbeat().await {
                warn!("Heartbeat failure: {}", e);
            }

            // 3. Maintenance (Prune old synced data)
            if let Err(e) = self.storage.prune_synced_events() {
                warn!("Storage maintenance failed: {}", e);
            }
        }
    }

    fn get_hardware_fingerprint(&self) -> String {
        self.config.agent.hardware_fingerprint.as_deref()
            .unwrap_or("unknown").to_string()
    }

    fn get_os_version(&self) -> Option<String> {
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            // Use wmic to get OS info
            // wmic os get Caption,Version /value
            if let Ok(output) = Command::new("wmic")
                .args(&["os", "get", "Caption,Version", "/value"])
                .creation_flags(CREATE_NO_WINDOW)
                .output() 
            {
                if let Ok(text) = String::from_utf8(output.stdout) {
                    let mut caption = String::new();
                    let mut version = String::new();
                    
                    for line in text.lines() {
                        let line = line.trim();
                        if line.starts_with("Caption=") {
                            caption = line.trim_start_matches("Caption=").to_string();
                        } else if line.starts_with("Version=") {
                            version = line.trim_start_matches("Version=").to_string();
                        }
                    }
                    
                    if !caption.is_empty() {
                         if !version.is_empty() {
                             return Some(format!("{} ({})", caption, version));
                         }
                         return Some(caption);
                    }
                }
            }
            // Fallback
             std::env::consts::OS.to_string().into()
        }
        #[cfg(not(target_os = "windows"))]
        {
            Some(std::env::consts::OS.to_string())
        }
    }

    pub async fn enroll_agent(&self) -> Result<(String, String)> {
        let agent_id = {
            let config = self.config.agent.clone();
            config.agent_id.unwrap_or_else(|| crate::agent_logic::generate_agent_id())
        };

        let existing_org_id = self.config.agent.organization_id.clone();
        // An empty/blank token counts as "no token". The MSI can write enrollment_token = "" on
        // upgrade; that must NOT force an already-enrolled agent into a doomed re-enrollment.
        let has_token = self.config.backend.enrollment_token
            .as_deref()
            .map(|t| !t.trim().is_empty())
            .unwrap_or(false);

        if let Some(org_id) = existing_org_id {
            if !has_token {
                // Updating internal state
                {
                    let mut id_guard = self.identity.write().await;
                    id_guard.organization_id = Some(org_id.clone());
                    id_guard.agent_id = Some(agent_id.clone());
                }
                // Re-save identity so it's protected against the next config.toml reset.
                let _ = self.config.save_identity(&agent_id, &org_id);
                info!("Resuming session for Organization: {}", org_id);
                return Ok((agent_id, org_id));
            } else {
                info!("Found both Organization ID and Enrollment Token. Forcing re-enrollment to backend...");
            }
        }

        // ... Original Enrollment Logic ...
        let hw_fingerprint = self.get_hardware_fingerprint();
        let hostname = hostname::get().ok().map(|h| h.to_string_lossy().to_string());
        let os_version = self.get_os_version();
        
        let enrollment_token = self.config.backend.enrollment_token.as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .ok_or_else(|| anyhow::anyhow!("No enrollment token provided"))?;

        let enrollment = serde_json::json!({
            "agent_id": agent_id,
            "hardware_fingerprint": hw_fingerprint,
            "hostname": hostname,
            "os_version": os_version,
            "enrollment_token": enrollment_token,
        });

        info!("Contacting C2 for enrollment...");
        let url = format!("{}/api/v1/agents/enroll", self.config.backend.url);
        let mut request = self.client.post(&url).json(&enrollment);

        if let Some(api_key) = &self.config.backend.api_key {
            request = request.header("X-API-Key", api_key);
        }

        let response = request.send().await.context("Enrollment request failed")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Enrollment denied {}: {}", status, body);
        }

        let result: serde_json::Value = response.json().await?;
        let org_id = result.get("organization_id").and_then(|v| v.as_str())
            .context("Server missing organization_id")?
            .to_string();
        let org_name = result.get("organization_name").and_then(|v| v.as_str())
            .unwrap_or("Unknown Org");

        {
            let mut id_guard = self.identity.write().await;
            id_guard.organization_id = Some(org_id.clone());
            id_guard.agent_id = Some(agent_id.clone());
        }
        
        info!("ACQUIRED: Organization '{}' ({})", org_name, org_id);

        // PERSISTENCE: Save the newly acquired identity to disk
        // This ensures the agent remains the same after a reboot.
        let mut new_config = (*self.config).clone();
        new_config.agent.agent_id = Some(agent_id.clone());
        new_config.agent.organization_id = Some(org_id.clone());
        new_config.backend.enrollment_token = None; // Security: Wipe token after use

        if let Err(e) = new_config.save() {
            error!("Failed to persist enrollment state to disk: {}", e);
        } else {
            info!("Agent identity persisted to config.toml");
        }

        // Also persist to the MSI-independent identity file so enrollment survives MSI upgrades
        // (config.toml gets reset on auto-update; identity.toml does not).
        if let Err(e) = self.config.save_identity(&agent_id, &org_id) {
            error!("Failed to persist identity.toml: {}", e);
        }

        Ok((agent_id, org_id))
    }

    pub async fn sync_events(&self) -> Result<()> {
        // 1. Fetch from Disk
        let batched_events = self.storage.fetch_unsynced_events(100)?; // Batch 100

        if batched_events.is_empty() {
            return Ok(());
        }

        let (current_agent_id, _) = self.get_identity().await;
        if current_agent_id == "unknown" {
            warn!("Cannot sync: agent_id is still 'unknown' (not enrolled yet)");
            return Ok(());
        }

        // Partition the batch:
        //   - events tagged with the current identity → send.
        //   - events tagged "unknown" or with any other agent_id → drop.
        //     These are pre-enrollment buffer or leftovers from a prior identity
        //     (e.g. a previous MSI install whose queue survived in ProgramData),
        //     and reattributing them to the new identity poisons the dashboard.
        let mut events: Vec<Event> = Vec::with_capacity(batched_events.len());
        let mut send_ids: Vec<i64> = Vec::with_capacity(batched_events.len());
        let mut stale_ids: Vec<i64> = Vec::new();
        for (id, event) in batched_events {
            if event.agent_id == current_agent_id {
                events.push(event);
                send_ids.push(id);
            } else {
                stale_ids.push(id);
            }
        }

        if !stale_ids.is_empty() {
            warn!(
                "Discarding {} queued events not tagged with current identity ({})",
                stale_ids.len(), current_agent_id
            );
            // Mark them synced so the next prune cycle removes them.
            // They never leave this machine.
            if let Err(e) = self.storage.mark_synced(&stale_ids) {
                error!("Failed to mark stale events as synced: {}", e);
            }
        }

        if events.is_empty() {
            return Ok(());
        }

        info!("Pushing {} buffered events to backend...", events.len());

        // 2. Send to Backend
        let url = format!("{}/api/v1/events", self.config.backend.url);
        let mut request = self.client.post(&url).json(&events);

        if let Some(api_key) = &self.config.backend.api_key {
            request = request.header("X-API-Key", api_key);
        }

        let org_id = self.identity.read().await.organization_id.clone();
        if let Some(org_id) = org_id {
            request = request.header("X-Organization-Id", org_id);
        }

        let response = request.send().await.context("Sync connection failed")?;

        if !response.status().is_success() {
            // On failure, we DO NOT mark as synchronized. They stay in DB for retry.
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Backend rejected events {}: {}", status, body);
        }

        // 3. Mark Synced on Success (Transaction)
        self.storage.mark_synced(&send_ids)?;

        info!("Confirmed delivery of {} events.", events.len());
        Ok(())
    }

    async fn send_heartbeat(&self) -> Result<()> {
        let (agent_id, _) = self.get_identity().await;
        let hw_fingerprint = self.get_hardware_fingerprint();
        let hostname = hostname::get().ok().map(|h| h.to_string_lossy().to_string());

        let heartbeat = Heartbeat {
            agent_id,
            hardware_fingerprint: hw_fingerprint.to_string(),
            timestamp: Utc::now(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            hostname,
        };

        let url = format!("{}/api/v1/agents/heartbeat", self.config.backend.url);
        let mut request = self.client.post(&url).json(&heartbeat);

        if let Some(api_key) = &self.config.backend.api_key {
            request = request.header("X-API-Key", api_key);
        }

        let org_id = self.identity.read().await.organization_id.clone();
        if let Some(org_id) = org_id {
            request = request.header("X-Organization-Id", org_id);
        }
        
        let response = request.send().await.context("Heartbeat failed")?;

        if !response.status().is_success() {
            anyhow::bail!("Heartbeat status: {}", response.status());
        }

        // The backend may advertise a newer agent build. If so, self-update (download MSI,
        // verify, hand to msiexec). Errors are swallowed inside maybe_apply so a bad update
        // never marks the heartbeat itself as failed.
        if let Ok(body) = response.json::<serde_json::Value>().await {
            if let Some(update) = body.get("update") {
                if let Ok(info) = serde_json::from_value::<crate::update::UpdateInfo>(update.clone()) {
                    crate::update::maybe_apply(&self.config, &info).await;
                }
            }
        }

        Ok(())
    }
}
