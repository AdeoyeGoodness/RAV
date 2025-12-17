use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, StatusCode},
    response::{Json, Response},
    body::Body,
};
use chrono::Utc;
use serde::Deserialize;
use sqlx::Row;
use uuid::Uuid;

use crate::db::models::{CreateAgent, CreateEvent, Event};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct EventQuery {
    pub agent_id: Option<String>,
    pub event_type: Option<String>,
    pub start_time: Option<chrono::DateTime<Utc>>,
    pub end_time: Option<chrono::DateTime<Utc>>,
    pub limit: Option<i64>,
}

pub async fn ingest_events(
    State(state): State<AppState>,
    Json(events): Json<Vec<CreateEvent>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();
    let events_count = events.len();

    for event in events {
        let result = sqlx::query(
            r#"
            INSERT INTO events (id, agent_id, event_type, timestamp, metadata, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(&event.agent_id)
        .bind(&event.event_type)
        .bind(event.timestamp)
        .bind(&event.metadata)
        .bind(Utc::now())
        .execute(pool)
        .await;

        if let Err(e) = result {
            tracing::error!("Failed to insert event: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    Ok(Json(serde_json::json!({
        "status": "success",
        "events_ingested": events_count
    })))
}

pub async fn query_events(
    State(state): State<AppState>,
    Query(params): Query<EventQuery>,
) -> Result<Json<Vec<Event>>, StatusCode> {
    let pool = state.db.pool();

    // For now, use a simple query - can be enhanced with proper filtering later
    let limit = params.limit.unwrap_or(100);
    
    let events = if let Some(agent_id) = &params.agent_id {
        sqlx::query_as::<_, Event>(
            "SELECT id, agent_id, event_type, timestamp, metadata, created_at FROM events WHERE agent_id = $1 ORDER BY timestamp DESC LIMIT $2"
        )
        .bind(agent_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, Event>(
            "SELECT id, agent_id, event_type, timestamp, metadata, created_at FROM events ORDER BY timestamp DESC LIMIT $1"
        )
        .bind(limit)
        .fetch_all(pool)
        .await
    }
    .map_err(|e| {
        tracing::error!("Failed to query events: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(events))
}

pub async fn register_agent(
    State(state): State<AppState>,
    Json(agent): Json<CreateAgent>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();

    let result = sqlx::query(
        r#"
        INSERT INTO agents (id, agent_id, hardware_fingerprint, last_seen, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (agent_id) DO UPDATE
        SET hardware_fingerprint = EXCLUDED.hardware_fingerprint,
            last_seen = EXCLUDED.last_seen,
            updated_at = EXCLUDED.updated_at
        RETURNING id
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(&agent.agent_id)
    .bind(&agent.hardware_fingerprint)
    .bind(Utc::now())
    .bind(Utc::now())
    .bind(Utc::now())
    .fetch_one(pool)
    .await;

    match result {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "success",
            "message": "Agent registered"
        }))),
        Err(e) => {
            tracing::error!("Failed to register agent: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct HeartbeatRequest {
    pub agent_id: String,
    pub hardware_fingerprint: String,
    pub timestamp: chrono::DateTime<Utc>,
    pub version: String,
}

pub async fn heartbeat(
    State(state): State<AppState>,
    Json(heartbeat): Json<HeartbeatRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();

    let result = sqlx::query(
        r#"
        UPDATE agents
        SET last_seen = $1, updated_at = $2
        WHERE agent_id = $3
        "#,
    )
    .bind(heartbeat.timestamp)
    .bind(Utc::now())
    .bind(&heartbeat.agent_id)
    .execute(pool)
    .await;

    match result {
        Ok(_) => Ok(Json(serde_json::json!({
            "status": "success"
        }))),
        Err(e) => {
            tracing::error!("Failed to update heartbeat: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn list_agents(
    State(state): State<AppState>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    let pool = state.db.pool();

    let agents = sqlx::query(
        r#"
        SELECT id, agent_id, hardware_fingerprint, last_seen, license_expiry, created_at, updated_at
        FROM agents
        ORDER BY last_seen DESC
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to query agents: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let result: Vec<serde_json::Value> = agents
        .iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<Uuid, _>("id"),
                "agent_id": row.get::<String, _>("agent_id"),
                "hardware_fingerprint": row.get::<String, _>("hardware_fingerprint"),
                "last_seen": row.get::<chrono::DateTime<Utc>, _>("last_seen"),
                "license_expiry": row.get::<Option<chrono::DateTime<Utc>>, _>("license_expiry"),
                "created_at": row.get::<chrono::DateTime<Utc>, _>("created_at"),
                "updated_at": row.get::<chrono::DateTime<Utc>, _>("updated_at"),
            })
        })
        .collect();

    Ok(Json(result))
}

pub async fn upload_file(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let mut file_id = String::new();
    let mut file_name = String::new();
    let mut _file_path = String::new();
    let mut _file_size = 0u64;
    let mut file_data: Option<Vec<u8>> = None;
    
    // Parse multipart form
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Multipart error: {}", e);
        StatusCode::BAD_REQUEST
    })? {
        let name = field.name().unwrap_or("");
        
        match name {
            "file_id" => {
                file_id = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?;
            }
            "file_name" => {
                file_name = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?;
            }
            "file_path" => {
                _file_path = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?;
            }
            "file_size" => {
                let size_str = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?;
                _file_size = size_str.parse().unwrap_or(0);
            }
            "file" => {
                file_data = Some(field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?.to_vec());
            }
            _ => {}
        }
    }
    
    if file_id.is_empty() || file_name.is_empty() || file_data.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }
    
    let data = file_data.unwrap();
    
    // Determine file extension
    let extension = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin");
    
    // Save file to storage
    let file_path_storage = state.file_storage_dir.join(format!("{}.{}", file_id, extension));
    
    if let Err(e) = std::fs::write(&file_path_storage, &data) {
        tracing::error!("Failed to save file: {}", e);
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }
    
    tracing::info!("File uploaded: {} ({} bytes)", file_id, data.len());
    
    Ok(Json(serde_json::json!({
        "status": "success",
        "file_id": file_id,
        "file_name": file_name,
        "file_size": data.len()
    })))
}

pub async fn download_file(
    State(state): State<AppState>,
    Path(file_id): Path<String>,
) -> Result<Response<Body>, StatusCode> {
    
    // Find file in storage directory
    let storage_dir = &state.file_storage_dir;
    let mut file_path: Option<std::path::PathBuf> = None;
    
    // Search for file with any extension
    if let Ok(entries) = std::fs::read_dir(storage_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if stem == file_id {
                    file_path = Some(path);
                    break;
                }
            }
        }
    }
    
    let file_path = file_path.ok_or(StatusCode::NOT_FOUND)?;
    
    // Read file
    let file_data = std::fs::read(&file_path).map_err(|e| {
        tracing::error!("Failed to read file: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    
    // Get file name from path
    let file_name = file_path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file")
        .to_string();
    
    // Determine content type
    let content_type = if file_name.ends_with(".png") {
        "image/png"
    } else if file_name.ends_with(".jpg") || file_name.ends_with(".jpeg") {
        "image/jpeg"
    } else if file_name.ends_with(".pdf") {
        "application/pdf"
    } else if file_name.ends_with(".txt") {
        "text/plain"
    } else if file_name.ends_with(".doc") || file_name.ends_with(".docx") {
        "application/msword"
    } else {
        "application/octet-stream"
    };
    
    // Create response with file
    let response = Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", file_name),
        )
        .body(Body::from(file_data))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(response)
}

pub async fn delete_agent_events(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();
    
    // Delete all events for this agent
    let result = sqlx::query(
        "DELETE FROM events WHERE agent_id = $1"
    )
    .bind(&agent_id)
    .execute(pool)
    .await;
    
    match result {
        Ok(result) => {
            let deleted_count = result.rows_affected();
            tracing::info!("Deleted {} events for agent {}", deleted_count, agent_id);
            
            Ok(Json(serde_json::json!({
                "status": "success",
                "message": format!("Deleted {} events for agent {}", deleted_count, agent_id),
                "deleted_count": deleted_count
            })))
        }
        Err(e) => {
            tracing::error!("Failed to delete events for agent {}: {}", agent_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn delete_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();
    
    // First delete all events for this agent
    let events_result = sqlx::query(
        "DELETE FROM events WHERE agent_id = $1"
    )
    .bind(&agent_id)
    .execute(pool)
    .await;
    
    let events_deleted = if let Ok(result) = events_result {
        result.rows_affected()
    } else {
        0
    };
    
    // Then delete the agent itself
    let agent_result = sqlx::query(
        "DELETE FROM agents WHERE agent_id = $1"
    )
    .bind(&agent_id)
    .execute(pool)
    .await;
    
    match agent_result {
        Ok(result) => {
            let agent_deleted = result.rows_affected();
            tracing::info!("Deleted agent {} and {} events", agent_id, events_deleted);
            
            Ok(Json(serde_json::json!({
                "status": "success",
                "message": format!("Deleted agent {} and {} events", agent_id, events_deleted),
                "agent_deleted": agent_deleted > 0,
                "events_deleted": events_deleted
            })))
        }
        Err(e) => {
            tracing::error!("Failed to delete agent {}: {}", agent_id, e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

