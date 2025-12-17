use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tracing::{error, info, warn};

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
}

pub struct SyncManager {
    config: Arc<Config>,
    client: reqwest::Client,
    event_queue: Arc<tokio::sync::mpsc::UnboundedSender<Event>>,
    event_receiver: Arc<tokio::sync::Mutex<tokio::sync::mpsc::UnboundedReceiver<Event>>>,
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
        // Register agent on startup
        if let Err(e) = self.register_agent().await {
            error!("Failed to register agent: {}", e);
        } else {
            info!("Agent registered successfully");
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

    async fn register_agent(&self) -> Result<()> {
        let agent_id = self.config.agent.agent_id.as_deref()
            .unwrap_or("unknown");
        let hw_fingerprint = self.config.agent.hardware_fingerprint.as_deref()
            .unwrap_or("unknown");

        let registration = serde_json::json!({
            "agent_id": agent_id,
            "hardware_fingerprint": hw_fingerprint,
        });

        let url = format!("{}/api/v1/agents/register", self.config.backend.url);
        let mut request = self.client.post(&url).json(&registration);

        if let Some(api_key) = &self.config.backend.api_key {
            request = request.header("X-API-Key", api_key);
        }

        let response = request
            .send()
            .await
            .context("Failed to register agent")?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            anyhow::bail!("Registration failed with status {}: {}", status, body);
        }

        info!("Agent registered: {} ({})", agent_id, hw_fingerprint);
        Ok(())
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

        let heartbeat = Heartbeat {
            agent_id: agent_id.to_string(),
            hardware_fingerprint: hw_fingerprint.to_string(),
            timestamp: Utc::now(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        };

        let url = format!("{}/api/v1/agents/heartbeat", self.config.backend.url);
        let mut request = self.client.post(&url).json(&heartbeat);

        if let Some(api_key) = &self.config.backend.api_key {
            request = request.header("X-API-Key", api_key);
        }

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

