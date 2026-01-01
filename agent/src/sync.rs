use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::time::{interval, Duration};
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

pub struct SyncManager {
    config: Arc<Config>,
    client: reqwest::Client,
    storage: Arc<StorageManager>,
    identity: Arc<tokio::sync::RwLock<AgentIdentity>>,
}

impl SyncManager {
    // Modified: Now takes Arc<StorageManager> dependency
    pub fn new(config: Arc<Config>, storage: Arc<StorageManager>) -> Result<Self> {
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(false)
            .timeout(Duration::from_secs(30))
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

    pub async fn run_sync_loop(&self) {
        // Enroll agent on startup
        if let Err(e) = self.enroll_agent().await {
            error!("Failed to enroll agent: {}", e);
        } else {
            info!("Agent key negotiation successful");
        }

        let mut interval = interval(Duration::from_secs(
            self.config.backend.sync_interval_seconds
        ));

        loop {
            interval.tick().await;
            
            if let Err(e) = self.sync_events().await {
                error!("Sync cycle failed: {}", e);
            }

            if let Err(e) = self.send_heartbeat().await {
                warn!("Heartbeat failed: {}", e);
            }

            // Optional: Prune old synced events to keep DB lean
            // Run this less frequently? For now, every sync cycle is fine as it's cheap.
            if let Err(e) = self.storage.prune_synced_events() {
                warn!("Pruning failed: {}", e);
            }
        }
    }

    fn get_hardware_fingerprint(&self) -> String {
        self.config.agent.hardware_fingerprint.as_deref()
            .unwrap_or("unknown").to_string()
    }

    pub async fn enroll_agent(&self) -> Result<(String, String)> {
        let agent_id = {
            let config = self.config.agent.clone();
            config.agent_id.unwrap_or_else(|| crate::agent_logic::generate_agent_id())
        };

        let existing_org_id = self.config.agent.organization_id.clone();
        
        if let Some(org_id) = existing_org_id {
            // Updating internal state
            {
                let mut id_guard = self.identity.write().await;
                id_guard.organization_id = Some(org_id.clone());
                id_guard.agent_id = Some(agent_id.clone());
            }
            info!("Resuming session for Organization: {}", org_id);
            return Ok((agent_id, org_id));
        }

        // ... Original Enrollment Logic ...
        let hw_fingerprint = self.get_hardware_fingerprint();
        let hostname = hostname::get().ok().map(|h| h.to_string_lossy().to_string());
        
        let enrollment_token = self.config.backend.enrollment_token.as_deref()
            .ok_or_else(|| anyhow::anyhow!("No enrollment token provided"))?;

        let enrollment = serde_json::json!({
            "agent_id": agent_id,
            "hardware_fingerprint": hw_fingerprint,
            "hostname": hostname,
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

        Ok((agent_id, org_id))
    }

    pub async fn sync_events(&self) -> Result<()> {
        // 1. Fetch from Disk
        let batched_events = self.storage.fetch_unsynced_events(100)?; // Batch 100
        
        if batched_events.is_empty() {
            return Ok(());
        }

        // Clone events to allow modification (rebinding agent_id)
        let mut events: Vec<Event> = batched_events.iter().map(|(_, e)| e.clone()).collect();
        let event_ids: Vec<i64> = batched_events.iter().map(|(id, _)| *id).collect();

        // Late Binding: ALWAYS bind events to current identity before sending
        // This ensures events captured before enrollment are correctly tagged
        let (current_agent_id, _) = self.get_identity().await;
        if current_agent_id != "unknown" {
            for event in &mut events {
                // Force all events to use the enrolled agent_id
                event.agent_id = current_agent_id.clone();
            }
            info!("Rebinding {} events to agent_id: {}", events.len(), current_agent_id);
        } else {
            warn!("Cannot sync: agent_id is still 'unknown' (not enrolled yet)");
            return Ok(()); // Don't send events with unknown agent_id
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
        self.storage.mark_synced(&event_ids)?;
        
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

        Ok(())
    }
}
