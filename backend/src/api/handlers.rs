use axum::{
    extract::{Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{Json, Response},
    body::Body,
};
use tracing::info;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use crate::db::models::{CreateAgent, CreateEvent, Event};
use crate::api::auth::Claims;
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

    if events.is_empty() {
        return Ok(Json(serde_json::json!({
            "status": "success",
            "events_ingested": 0
        })));
    }

    let first_agent_id = &events[0].agent_id;
    let org_id = sqlx::query!(
        "SELECT organization_id FROM agents WHERE agent_id = $1",
        first_agent_id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to query agent organization: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .map(|r| r.organization_id)
    .ok_or_else(|| {
        tracing::warn!("Agent not found for ingestion: {}", first_agent_id);
        StatusCode::UNAUTHORIZED
    })?;

    for event in events {
        let result = sqlx::query!(
            r#"
            INSERT INTO events (id, organization_id, agent_id, event_type, timestamp, metadata, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            "#,
            Uuid::new_v4(),
            org_id,
            event.agent_id,
            event.event_type,
            event.timestamp,
            &event.metadata,
            Utc::now()
        )
        .execute(pool)
        .await;

        if let Err(e) = result {
            tracing::error!("Failed to insert event: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    Ok(Json(serde_json::json!({
        "status": "success",
        "events_ingested": events_count,
        "organization_id": org_id
    })))
}

pub async fn query_events(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Query(params): Query<EventQuery>,
) -> Result<Json<Vec<Event>>, StatusCode> {
    let pool = state.db.pool();

    // Determine target organization_id
    let target_org_id = if claims.role == "super_admin" {
        // Super Admin must explicitly provide a header to see raw data
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)? // Super Admin must specify org
    } else {
        // Tenants are locked to their own ID from the JWT
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    let limit = params.limit.unwrap_or(100);
    
    let events = if let Some(agent_id) = &params.agent_id {
        sqlx::query_as::<_, Event>(
            "SELECT id, organization_id, agent_id, event_type, timestamp, metadata, created_at FROM events WHERE agent_id = $1 AND organization_id = $2 AND deleted_at IS NULL ORDER BY timestamp DESC LIMIT $3"
        )
        .bind(agent_id)
        .bind(target_org_id)
        .bind(limit)
        .fetch_all(pool)
        .await
    } else {
        sqlx::query_as::<_, Event>(
            "SELECT id, organization_id, agent_id, event_type, timestamp, metadata, created_at FROM events WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY timestamp DESC LIMIT $2"
        )
        .bind(target_org_id)
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

pub async fn enroll_agent(
    State(state): State<AppState>,
    Json(payload): Json<CreateAgent>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();

    // 1. Look up organization by license key (enrollment token)
    let org = sqlx::query!(
        "SELECT id, name FROM organizations WHERE license_key = $1 AND status = 'active'",
        payload.license_key
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!("Enrollment: Failed to query organization: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let org_info = org.ok_or_else(|| {
        tracing::warn!("Enrollment attempt with invalid/inactive token: {}", payload.license_key);
        StatusCode::UNAUTHORIZED
    })?;

    // 2. Enroll agent (Insert or update seen timestamp)
    sqlx::query!(
        r#"
        INSERT INTO agents (id, organization_id, agent_id, hardware_fingerprint, last_seen, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (agent_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at,
            last_seen = EXCLUDED.last_seen
        "#,
        Uuid::new_v4(),
        org_info.id,
        payload.agent_id,
        payload.hardware_fingerprint,
        Utc::now(),
        Utc::now(),
        Utc::now()
    )
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!("Enrollment: Failed to insert/update agent: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    info!("Agent enrolled: {} for Organization: {}", payload.agent_id, org_info.name);

    Ok(Json(serde_json::json!({
        "status": "success",
        "agent_id": payload.agent_id,
        "organization_id": org_info.id,
        "organization_name": org_info.name
    })))
}

pub async fn register_agent(
    State(state): State<AppState>,
    Json(agent): Json<CreateAgent>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Legacy support or redirect to enroll
    enroll_agent(State(state), Json(agent)).await
}

pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(heartbeat): Json<crate::db::models::Heartbeat>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();

    let org_id = headers
        .get("X-Organization-Id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let result = sqlx::query!(
        r#"
        UPDATE agents
        SET last_seen = $1, updated_at = $2
        WHERE agent_id = $3 AND organization_id = $4
        "#,
        heartbeat.timestamp,
        Utc::now(),
        &heartbeat.agent_id,
        org_id
    )
    .execute(pool)
    .await;

    match result {
        Ok(res) if res.rows_affected() > 0 => Ok(Json(serde_json::json!({"status": "success"}))),
        Ok(_) => Err(StatusCode::NOT_FOUND),
        Err(e) => {
            tracing::error!("Failed to update heartbeat: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub async fn list_agents(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    let pool = state.db.pool();

    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    let agents = sqlx::query(
        r#"
        SELECT id, organization_id, agent_id, hardware_fingerprint, last_seen, created_at, updated_at
        FROM agents
        WHERE organization_id = $1 AND deleted_at IS NULL
        ORDER BY last_seen DESC
        "#,
    )
    .bind(target_org_id)
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to query agents: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let result: Vec<serde_json::Value> = agents
        .into_iter()
        .map(|row| {
            serde_json::json!({
                "id": row.get::<Uuid, _>("id"),
                "organization_id": row.get::<Uuid, _>("organization_id"),
                "agent_id": row.get::<String, _>("agent_id"),
                "hardware_fingerprint": row.get::<String, _>("hardware_fingerprint"),
                "last_seen": row.get::<chrono::DateTime<Utc>, _>("last_seen"),
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
    let mut agent_id = String::new();
    let mut file_data: Option<Vec<u8>> = None;
    
    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Multipart error: {}", e);
        StatusCode::BAD_REQUEST
    })? {
        match field.name().unwrap_or("") {
            "file_id" => file_id = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?,
            "file_name" => file_name = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?,
            "agent_id" => agent_id = field.text().await.map_err(|_| StatusCode::BAD_REQUEST)?,
            "file" => file_data = Some(field.bytes().await.map_err(|_| StatusCode::BAD_REQUEST)?.to_vec()),
            _ => {}
        }
    }
    
    if file_id.is_empty() || file_name.is_empty() || file_data.is_none() || agent_id.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let pool = state.db.pool();
    let org_id = sqlx::query!("SELECT organization_id FROM agents WHERE agent_id = $1", agent_id)
        .fetch_optional(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map(|r| r.organization_id)
        .ok_or(StatusCode::UNAUTHORIZED)?;
    
    let data = file_data.unwrap();
    sqlx::query!(
        "INSERT INTO files (file_id, organization_id, agent_id, file_name, file_size) VALUES ($1, $2, $3, $4, $5)",
        file_id, org_id, agent_id, file_name, data.len() as i64
    )
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to record file in DB: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    
    let extension = std::path::Path::new(&file_name).extension().and_then(|e| e.to_str()).unwrap_or("bin");
    let file_path_storage = state.file_storage_dir.join(format!("{}.{}", file_id, extension));
    std::fs::write(&file_path_storage, &data).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(serde_json::json!({
        "status": "success",
        "file_id": file_id,
        "file_name": file_name,
        "file_size": data.len()
    })))
}

pub async fn download_file(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(file_id): Path<String>,
) -> Result<Response<Body>, StatusCode> {
    let pool = state.db.pool();

    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    let file_record = sqlx::query!(
        "SELECT file_name FROM files WHERE file_id = $1 AND organization_id = $2",
        file_id, target_org_id
    )
    .fetch_optional(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let storage_dir = &state.file_storage_dir;
    let mut file_path: Option<std::path::PathBuf> = None;
    if let Ok(entries) = std::fs::read_dir(storage_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.file_stem().and_then(|s| s.to_str()) == Some(&file_id) {
                file_path = Some(path);
                break;
            }
        }
    }
    
    let file_path = file_path.ok_or(StatusCode::NOT_FOUND)?;
    let file_data = std::fs::read(&file_path).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
    
    let content_type = match std::path::Path::new(&file_name).extension().and_then(|e| e.to_str()) {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    };
    
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", file_name))
        .body(Body::from(file_data))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?)
}

pub async fn delete_agent_events(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();

    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };
    
    let result = sqlx::query!(
        "UPDATE events SET deleted_at = $1 WHERE agent_id = $2 AND organization_id = $3 AND deleted_at IS NULL",
        Utc::now(), &agent_id, target_org_id
    )
    .execute(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(serde_json::json!({
        "status": "success",
        "deleted_count": result.rows_affected()
    })))
}

pub async fn delete_agent(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();

    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    sqlx::query!(
        "UPDATE agents SET deleted_at = $1 WHERE agent_id = $2 AND organization_id = $3 AND deleted_at IS NULL",
        Utc::now(), &agent_id, target_org_id
    )
    .execute(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(serde_json::json!({"status": "success"})))
}

pub async fn restore_agent_events(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // RESTRICTION: Only Super Admin can restore
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let target_org_id = headers
        .get("X-Organization-Id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(StatusCode::BAD_REQUEST)?;

    let pool = state.db.pool();
    let result = sqlx::query!(
        "UPDATE events SET deleted_at = NULL WHERE agent_id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL",
        &agent_id, target_org_id
    )
    .execute(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(serde_json::json!({
        "status": "success",
        "restored_count": result.rows_affected()
    })))
}

