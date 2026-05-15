//! Extension Server Module
//! 
//! Provides a local HTTP server (localhost only) for the browser extension
//! to send events to the agent. This is a secure, local-only communication channel.

use anyhow::Result;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing::{info, warn};

use crate::config::Config;
use crate::sync::{Event, SyncManager};

// ============================================================================
// Types matching the extension's TypeScript types
// ============================================================================

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
pub struct ExtensionResponse {
    pub success: bool,
    pub events_processed: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PingResponse {
    pub status: String,
    pub agent_version: String,
}

// ============================================================================
// Server State
// ============================================================================

#[derive(Clone)]
pub struct ExtensionServerState {
    pub config: Arc<Config>,
    pub sync_manager: Arc<SyncManager>,
}

// ============================================================================
// Server Implementation
// ============================================================================

/// Start the extension HTTP server on localhost:8089
pub async fn start_extension_server(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    
    let state = ExtensionServerState {
        config: config.clone(),
        sync_manager,
    };

    let app = Router::new()
        .route("/api/extension/ping", get(handle_ping))
        .route("/api/extension/events", post(handle_events))
        .layer(axum::middleware::from_fn(cors_middleware))
        .with_state(state);

    // IMPORTANT: Bind to 127.0.0.1 ONLY - never expose to network
    let addr = SocketAddr::from(([127, 0, 0, 1], 8089));
    
    info!("Extension server starting on http://{}", addr);
    info!("This endpoint is localhost-only for security");

    let listener = TcpListener::bind(addr).await?;
    
    axum::serve(listener, app).await?;

    Ok(())
}

/// CORS middleware - allows browser extensions to make requests
async fn cors_middleware(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> axum::response::Response {
    use axum::http::Method;
    use axum::response::IntoResponse;
    
    // Handle OPTIONS preflight requests immediately
    if req.method() == Method::OPTIONS {
        let mut response = StatusCode::OK.into_response();
        let headers = response.headers_mut();
        headers.insert("Access-Control-Allow-Origin", "*".parse().unwrap());
        headers.insert("Access-Control-Allow-Methods", "GET, POST, OPTIONS".parse().unwrap());
        headers.insert("Access-Control-Allow-Headers", "Content-Type, X-RAV-Extension".parse().unwrap());
        return response;
    }
    
    let mut response = next.run(req).await;
    let headers = response.headers_mut();
    headers.insert("Access-Control-Allow-Origin", "*".parse().unwrap());
    headers.insert("Access-Control-Allow-Methods", "GET, POST, OPTIONS".parse().unwrap());
    headers.insert("Access-Control-Allow-Headers", "Content-Type, X-RAV-Extension".parse().unwrap());
    response
}

/// Handle OPTIONS preflight requests
async fn handle_options() -> StatusCode {
    StatusCode::OK
}

// ============================================================================
// Handlers
// ============================================================================

/// Health check / ping endpoint
async fn handle_ping() -> Json<PingResponse> {
    Json(PingResponse {
        status: "ok".to_string(),
        agent_version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

/// Receive events from the browser extension
async fn handle_events(
    State(state): State<ExtensionServerState>,
    headers: HeaderMap,
    Json(payload): Json<ExtensionPayload>,
) -> Result<Json<ExtensionResponse>, (StatusCode, Json<ExtensionResponse>)> {
    // Log extension version from header
    if let Some(version) = headers.get("X-RAV-Extension") {
        info!(
            "Received {} events from extension v{}",
            payload.events.len(),
            version.to_str().unwrap_or("unknown")
        );
    }

    let agent_id = state.config.agent.agent_id.clone().unwrap_or_default();
    let mut processed = 0;
    let total_events = payload.events.len();

    for ext_event in payload.events {
        // Convert extension event to our internal Event format
        match convert_extension_event(&ext_event, &agent_id) {
            Ok(event) => {
                state.sync_manager.queue_event(event);
                processed += 1;
            }
            Err(e) => {
                warn!("Failed to convert extension event {}: {}", ext_event.event_id, e);
            }
        }
    }

    info!("Processed {}/{} extension events", processed, total_events);

    Ok(Json(ExtensionResponse {
        success: true,
        events_processed: processed,
        error: None,
    }))
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
        obj.insert("extension_event_id".to_string(), serde_json::json!(ext_event.event_id));
    }

    Ok(Event {
        event_type: event_type.to_string(),
        timestamp,
        agent_id: agent_id.to_string(),
        metadata,
    })
}
