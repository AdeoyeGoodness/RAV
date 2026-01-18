//! Native Messaging Host Module
//!
//! Implements Chrome/Edge Native Messaging protocol for browser extension communication.
//! Reads length-prefixed JSON messages from STDIN and writes responses to STDOUT.
//!
//! Protocol: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::sync::Arc;
use tracing::{error, info};

use crate::config::Config;
use crate::sync::{Event, SyncManager};

// ============================================================================
// Message Types (matches extension's TypeScript types)
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum NativeMessage {
    Ping(PingMessage),
    Events(ExtensionPayload),
}

#[derive(Debug, Deserialize)]
pub struct PingMessage {
    #[serde(rename = "type")]
    pub msg_type: String,
}

#[derive(Debug, Deserialize)]
pub struct ExtensionPayload {
    pub events: Vec<ExtensionEvent>,
    pub extension_version: String,
    pub batch_timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct ExtensionEvent {
    pub event_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub browser: String,
    pub profile: Option<String>,
    pub data: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct PingResponse {
    pub status: String,
    pub agent_version: String,
}

#[derive(Debug, Serialize)]
pub struct ExtensionResponse {
    pub success: bool,
    pub events_processed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

// ============================================================================
// Native Messaging Protocol Implementation
// ============================================================================

/// Read a single message from STDIN using Chrome Native Messaging protocol
/// Format: 4-byte length (u32 little-endian) + JSON payload
fn read_message() -> Result<NativeMessage> {
    let mut length_bytes = [0u8; 4];
    io::stdin()
        .read_exact(&mut length_bytes)
        .context("Failed to read message length")?;

    let message_length = u32::from_le_bytes(length_bytes) as usize;

    // Sanity check (Chrome has a 1MB limit)
    if message_length > 1024 * 1024 {
        anyhow::bail!("Message too large: {} bytes", message_length);
    }

    let mut buffer = vec![0u8; message_length];
    io::stdin()
        .read_exact(&mut buffer)
        .context("Failed to read message body")?;

    let message: NativeMessage =
        serde_json::from_slice(&buffer).context("Failed to parse JSON message")?;

    Ok(message)
}

/// Write a response to STDOUT using Chrome Native Messaging protocol
fn write_response<T: Serialize>(response: &T) -> Result<()> {
    let json = serde_json::to_vec(response).context("Failed to serialize response")?;

    let length = json.len() as u32;
    let length_bytes = length.to_le_bytes();

    io::stdout()
        .write_all(&length_bytes)
        .context("Failed to write response length")?;
    io::stdout()
        .write_all(&json)
        .context("Failed to write response body")?;
    io::stdout().flush().context("Failed to flush stdout")?;

    Ok(())
}

// ============================================================================
// Message Handlers
// ============================================================================

fn handle_ping() -> Result<()> {
    let response = PingResponse {
        status: "ok".to_string(),
        agent_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    write_response(&response)?;
    Ok(())
}

fn handle_events(
    payload: ExtensionPayload,
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    let agent_id = config.agent.agent_id.clone().unwrap_or_default();
    let total_events = payload.events.len();
    let mut processed = 0;

    info!(
        "Received {} events from extension v{}",
        total_events, payload.extension_version
    );

    for ext_event in payload.events {
        match convert_extension_event(&ext_event, &agent_id) {
            Ok(event) => {
                sync_manager.queue_event(event);
                processed += 1;
            }
            Err(e) => {
                error!("Failed to convert extension event {}: {}", ext_event.event_id, e);
            }
        }
    }

    let response = ExtensionResponse {
        success: true,
        events_processed: processed,
        error: None,
    };

    write_response(&response)?;
    info!("Processed {}/{} extension events", processed, total_events);

    Ok(())
}

/// Convert an extension event to our internal Event format
fn convert_extension_event(ext_event: &ExtensionEvent, agent_id: &str) -> Result<Event> {
    use chrono::{DateTime, Utc};

    // Parse timestamp
    let timestamp: DateTime<Utc> = ext_event
        .timestamp
        .parse()
        .unwrap_or_else(|_| Utc::now());

    // Map extension event types to our internal types
    let event_type = match ext_event.event_type.as_str() {
        "active_tab" => "browser_active_tab",
        "tab_updated" => "browser_tab_updated",
        "history_visit" => "browser_history_visit",
        "search_query" => "browser_search_query",
        "download_started" => "browser_download_started",
        "download_completed" => "browser_download_completed",
        "download_failed" => "browser_download_failed",
        other => other,
    };

    // Build metadata with browser info
    let mut metadata = ext_event.data.clone();
    if let Some(obj) = metadata.as_object_mut() {
        obj.insert("browser".to_string(), serde_json::json!(ext_event.browser));
        if let Some(profile) = &ext_event.profile {
            obj.insert("profile".to_string(), serde_json::json!(profile));
        }
        obj.insert(
            "extension_event_id".to_string(),
            serde_json::json!(ext_event.event_id),
        );
    }

    Ok(Event {
        event_type: event_type.to_string(),
        timestamp,
        agent_id: agent_id.to_string(),
        metadata,
    })
}

// ============================================================================
// Main Entry Point
// ============================================================================

/// Run the native messaging host (blocking, reads from STDIN until EOF/error)
pub fn run_native_host(config: Arc<Config>, sync_manager: Arc<SyncManager>) -> Result<()> {
    info!("Starting Native Messaging Host...");
    info!("Reading messages from STDIN (Chrome Native Messaging Protocol)");

    loop {
        match read_message() {
            Ok(message) => {
                let result = match message {
                    NativeMessage::Ping(_) => handle_ping(),
                    NativeMessage::Events(payload) => {
                        handle_events(payload, config.clone(), sync_manager.clone())
                    }
                };

                if let Err(e) = result {
                    error!("Error handling message: {}", e);
                    // Try to send error response
                    let error_response = ExtensionResponse {
                        success: false,
                        events_processed: 0,
                        error: Some(e.to_string()),
                    };
                    let _ = write_response(&error_response);
                }
            }
            Err(e) => {
                // EOF or read error means browser closed the connection
                if e.to_string().contains("failed to fill whole buffer") {
                    info!("Browser closed connection (EOF)");
                    break;
                }
                error!("Failed to read message: {}", e);
                break;
            }
        }
    }

    info!("Native Messaging Host shutting down");
    Ok(())
}
