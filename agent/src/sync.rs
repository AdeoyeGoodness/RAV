use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::config::Config;

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

pub struct SyncManager {
    config: Arc<Config>,
    client: reqwest::Client,
    event_queue: Arc<tokio::sync::mpsc::UnboundedSender<Event>>,
    event_receiver: Arc<tokio::sync::Mutex<tokio::sync::mpsc::UnboundedReceiver<Event>>>,
    organization_id: Arc<tokio::sync::Mutex<Option<String>>>,
}

impl SyncManager {
    pub fn new(config: Arc<Config>) -> impl std::future::Future<Output = Result<Self>> + Send {
        async move {
            let client = reqwest::Client::builder()
                .danger_accept_invalid_certs(false) // In production, use proper cert validation
                .timeout(Duration::from_secs(30))
                .build()
                .context("Failed to create HTTP client")?;

            let (tx, rx) = tokio::sync::mpsc::unbounded_channel();

            Ok(Self {
                config,
                client,
                event_queue: Arc::new(tx),
                event_receiver: Arc::new(tokio::sync::Mutex::new(rx)),
                organization_id: Arc::new(tokio::sync::Mutex::new(None)),
            })
        }
    }

    pub fn queue_event(&self, event: Event) {
        if let Err(e) = self.event_queue.send(event) {
            error!("Failed to queue event: {}", e);
        }
    }

    // Trigger immediate sync for important events (like screenshots)
    pub async fn sync_events_immediate(&self) {
        // Use the public sync_events method
        if let Err(e) = self.sync_events().await {
            error!("Immediate sync error: {}", e);
        }
    }

    pub async fn run_sync_loop(&self) {
        // Enroll agent on startup
        if let Err(e) = self.enroll_agent().await {
            error!("Failed to enroll agent: {}", e);
        } else {
            info!("Agent enrolled successfully");
        }

        let mut interval = interval(Duration::from_secs(
            self.config.backend.sync_interval_seconds
        ));

        loop {
            interval.tick().await;
            
            if let Err(e) = self.sync_events().await {
                error!("Sync error: {}", e);
            }

            if let Err(e) = self.send_heartbeat().await {
                warn!("Heartbeat error: {}", e);
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
            config.agent_id.unwrap_or_else(|| Uuid::new_v4().to_string())
        };

        // HARDENING: Check for existing lock-in
        let existing_org_id = {
            let config = self.config.agent.clone();
            config.organization_id
        };
        
        if let Some(org_id) = existing_org_id {
            // FIX: Ensure internal state is updated even if loading from config
            let mut org_guard = self.organization_id.lock().await;
            *org_guard = Some(org_id.clone());
            info!("Agent is already locked to Organization: {}. Skipping enrollment.", org_id);
            return Ok((agent_id, org_id));
        }

        let hw_fingerprint = self.get_hardware_fingerprint();
        let hostname = hostname::get().ok().map(|h| h.to_string_lossy().to_string());
        
        let enrollment_token = self.config.backend.enrollment_token.as_deref()
            .ok_or_else(|| anyhow::anyhow!("No enrollment token provided for technical onboarding"))?;

        let enrollment = serde_json::json!({
            "agent_id": agent_id,
            "hardware_fingerprint": hw_fingerprint,
            "hostname": hostname,
            "enrollment_token": enrollment_token,
        });

        info!("Attempting enrollment for agent {}...", agent_id);
        let url = format!("{}/api/v1/agents/enroll", self.config.backend.url);
        let mut request = self.client.post(&url).json(&enrollment);

        if let Some(api_key) = &self.config.backend.api_key {
            request = request.header("X-API-Key", api_key);
        }

        let response = request
            .send()
            .await
            .context("Failed to connect to enrollment endpoint")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Enrollment failed with status {}: {}", status, body);
        }

        let result: serde_json::Value = response.json().await?;
        let org_id = result.get("organization_id").and_then(|v| v.as_str())
            .context("Server did not return organization_id")?
            .to_string();
        let org_name = result.get("organization_name").and_then(|v| v.as_str())
            .unwrap_or("Unknown Org");

        let mut org_guard = self.organization_id.lock().await;
        *org_guard = Some(org_id.clone());
        
        info!("SUCCESS: Agent enrolled to Organization: {} ({})", org_name, org_id);
        Ok((agent_id, org_id))
    }

    pub async fn sync_events(&self) -> Result<()> {
        let mut events = Vec::new();
        
        // Collect events from queue (non-blocking)
        let mut receiver = self.event_receiver.lock().await;
        while let Ok(event) = receiver.try_recv() {
            events.push(event);
            if events.len() >= 100 {
                break; // Batch size limit
            }
        }

        if events.is_empty() {
            return Ok(());
        }

        info!("Syncing {} events to backend", events.len());

        let url = format!("{}/api/v1/events", self.config.backend.url);
        let mut request = self.client.post(&url).json(&events);

        if let Some(api_key) = &self.config.backend.api_key {
            request = request.header("X-API-Key", api_key);
        }

        // Add organization ID if we have it
        let org_guard = self.organization_id.lock().await;
        if let Some(org_id) = org_guard.as_ref() {
            request = request.header("X-Organization-Id", org_id);
        }
        drop(org_guard);

        let response = request
            .send()
            .await
            .context("Failed to send events to backend")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Backend returned error {}: {}", status, body);
        }

        info!("Successfully synced {} events", events.len());
        Ok(())
    }

    async fn send_heartbeat(&self) -> Result<()> {
        let agent_id = self.config.agent.agent_id.as_deref()
            .unwrap_or("unknown");
        let hw_fingerprint = self.config.agent.hardware_fingerprint.as_deref()
            .unwrap_or("unknown");

        let hostname = hostname::get().ok().map(|h| h.to_string_lossy().to_string());

        let heartbeat = Heartbeat {
            agent_id: agent_id.to_string(),
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

        // Add organization ID if we have it
        let org_guard = self.organization_id.lock().await;
        if let Some(org_id) = org_guard.as_ref() {
            request = request.header("X-Organization-Id", org_id);
        }
        drop(org_guard);

        let response = request
            .send()
            .await
            .context("Failed to send heartbeat")?;

        if !response.status().is_success() {
            let status = response.status();
            anyhow::bail!("Heartbeat failed with status: {}", status);
        }

        Ok(())
    }
}

