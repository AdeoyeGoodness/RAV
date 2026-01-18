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
    pub events: Vec\u003cExtensionEvent\u003e,
    pub extension_version: String,
    pub batch_timestamp: String,
}

#[derive(Debug, Deserialize)]
pub struct ExtensionEvent {
    pub event_id: String,
    pub event_type: String,
    pub timestamp: String,
    pub browser: String,
    pub profile: Option\u003cString\u003e,
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
    #[serde(skip_serializing_if = \"Option::is_none\")]
    pub error: Option\u003cString\u003e,
}

// ============================================================================
// Native Messaging Protocol Implementation
// ============================================================================

/// Read a single message from STDIN using Chrome Native Messaging protocol
/// Format: 4-byte length (u32 little-endian) + JSON payload
fn read_message() -\u003e Result\u003cNativeMessage\u003e {
    let mut length_bytes = [0u8; 4];
    io::stdin()
        .read_exact(\u0026mut length_bytes)
        .context(\"Failed to read message length\")?;

    let message_length = u32::from_le_bytes(length_bytes) as usize;

    // Sanity check (Chrome has a 1MB limit)
    if message_length \u003e 1024 * 1024 {
        anyhow::bail!(\"Message too large: {} bytes\", message_length);
    }

    let mut buffer = vec![0u8; message_length];
    io::stdin()
        .read_exact(\u0026mut buffer)
        .context(\"Failed to read message body\")?;

    let message: NativeMessage =
        serde_json::from_slice(\u0026buffer).context(\"Failed to parse JSON message\")?;

    Ok(message)
}

/// Write a response to STDOUT using Chrome Native Messaging protocol
fn write_response\u003cT: Serialize\u003e(response: \u0026T) -\u003e Result\u003c()\u003e {
    let json = serde_json::to_vec(response).context(\"Failed to serialize response\")?;

    let length = json.len() as u32;
    let length_bytes = length.to_le_bytes();

    io::stdout()
        .write_all(\u0026length_bytes)
        .context(\"Failed to write response length\")?;
    io::stdout()
        .write_all(\u0026json)
        .context(\"Failed to write response body\")?;
    io::stdout().flush().context(\"Failed to flush stdout\")?;

    Ok(())
}

// ============================================================================
// Message Handlers
// ============================================================================

fn handle_ping() -\u003e Result\u003c()\u003e {
    let response = PingResponse {
        status: \"ok\".to_string(),
        agent_version: env!(\"CARGO_PKG_VERSION\").to_string(),
    };
    write_response(\u0026response)?;
    Ok(())
}

fn handle_events(
    payload: ExtensionPayload,
    config: Arc\u003cConfig\u003e,
    sync_manager: Arc\u003cSyncManager\u003e,
) -\u003e Result\u003c()\u003e {
    let agent_id = config.agent.agent_id.clone().unwrap_or_default();
    let total_events = payload.events.len();
    let mut processed = 0;

    info!(
        \"Received {} events from extension v{}\",
        total_events, payload.extension_version
    );

    for ext_event in payload.events {
        match convert_extension_event(\u0026ext_event, \u0026agent_id) {
            Ok(event) =\u003e {
                sync_manager.queue_event(event);
                processed += 1;
            }
            Err(e) =\u003e {
                error!(\"Failed to convert extension event {}: {}\", ext_event.event_id, e);
            }
        }
    }

    let response = ExtensionResponse {
        success: true,
        events_processed: processed,
        error: None,
    };

    write_response(\u0026response)?;
    info!(\"Processed {}/{} extension events\", processed, total_events);

    Ok(())
}

/// Convert an extension event to our internal Event format
fn convert_extension_event(ext_event: \u0026ExtensionEvent, agent_id: \u0026str) -\u003e Result\u003cEvent\u003e {
    use chrono::{DateTime, Utc};

    // Parse timestamp
    let timestamp: DateTime\u003cUtc\u003e = ext_event
        .timestamp
        .parse()
        .unwrap_or_else(|_| Utc::now());

    // Map extension event types to our internal types
    let event_type = match ext_event.event_type.as_str() {
        \"active_tab\" =\u003e \"browser_active_tab\",
        \"tab_updated\" =\u003e \"browser_tab_updated\",
        \"history_visit\" =\u003e \"browser_history_visit\",
        \"search_query\" =\u003e \"browser_search_query\",
        \"download_started\" =\u003e \"browser_download_started\",
        \"download_completed\" =\u003e \"browser_download_completed\",
        \"download_failed\" =\u003e \"browser_download_failed\",
        other =\u003e other,
    };

    // Build metadata with browser info
    let mut metadata = ext_event.data.clone();
    if let Some(obj) = metadata.as_object_mut() {
        obj.insert(\"browser\".to_string(), serde_json::json!(ext_event.browser));
        if let Some(profile) = \u0026ext_event.profile {
            obj.insert(\"profile\".to_string(), serde_json::json!(profile));
        }
        obj.insert(
            \"extension_event_id\".to_string(),
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
pub fn run_native_host(config: Arc\u003cConfig\u003e, sync_manager: Arc\u003cSyncManager\u003e) -\u003e Result\u003c()\u003e {
    info!(\"Starting Native Messaging Host...\");
    info!(\"Reading messages from STDIN (Chrome Native Messaging Protocol)\");

    loop {
        match read_message() {
            Ok(message) =\u003e {
                let result = match message {
                    NativeMessage::Ping(_) =\u003e handle_ping(),
                    NativeMessage::Events(payload) =\u003e {
                        handle_events(payload, config.clone(), sync_manager.clone())
                    }
                };

                if let Err(e) = result {
                    error!(\"Error handling message: {}\", e);
                    // Try to send error response
                    let error_response = ExtensionResponse {
                        success: false,
                        events_processed: 0,
                        error: Some(e.to_string()),
                    };
                    let _ = write_response(\u0026error_response);
                }
            }
            Err(e) =\u003e {
                // EOF or read error means browser closed the connection
                if e.to_string().contains(\"failed to fill whole buffer\") {
                    info!(\"Browser closed connection (EOF)\");
                    break;
                }
                error!(\"Failed to read message: {}\", e);
                break;
            }
        }
    }

    info!(\"Native Messaging Host shutting down\");
    Ok(())
}
