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

use crate::db::models::{CreateAgent, CreateEvent, Event, ActorType};
use crate::services::audit::log_audit;
use crate::api::auth::Claims;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct EventQuery {
    pub agent_id: Option<String>,
    pub event_type: Option<String>,
    pub category: Option<String>,
    pub severity: Option<String>,
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
            INSERT INTO events (id, organization_id, agent_id, event_type, timestamp, metadata, severity, category, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            Uuid::new_v4(),
            org_id,
            event.agent_id,
            event.event_type,
            event.timestamp,
            &event.metadata,
            event.severity.as_deref().unwrap_or("low"),
            event.category.as_deref().unwrap_or("system"),
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
    
    let events = sqlx::query_as::<_, Event>(
        r#"
        SELECT id, organization_id, agent_id, event_type, timestamp, metadata, severity, category, created_at 
        FROM events 
        WHERE organization_id = $1 
          AND ($2::text IS NULL OR agent_id = $2)
          AND ($3::text IS NULL OR event_type = $3)
          AND ($4::text IS NULL OR category = $4)
          AND ($5::text IS NULL OR severity = $5)
          AND ($6::timestamptz IS NULL OR timestamp >= $6)
          AND ($7::timestamptz IS NULL OR timestamp <= $7)
          AND deleted_at IS NULL 
        ORDER BY timestamp DESC 
        LIMIT $8
        "#
    )
    .bind(target_org_id)
    .bind(&params.agent_id)
    .bind(&params.event_type)
    .bind(&params.category)
    .bind(&params.severity)
    .bind(params.start_time)
    .bind(params.end_time)
    .bind(limit)
    .fetch_all(pool)
    .await
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

    // 1. Look up organization by enrollment token
    let org = sqlx::query!(
        r#"
        SELECT id, name, token_expiry, max_agents,
        (SELECT COUNT(*) FROM agents WHERE organization_id = organizations.id AND deleted_at IS NULL) as "current_agents!"
        FROM organizations 
        WHERE enrollment_token = $1 AND status = 'active'
        "#,
        payload.enrollment_token
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!("Enrollment: Failed to query organization: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let org_info = org.ok_or_else(|| {
        tracing::warn!("Enrollment attempt with invalid/inactive token: {}", payload.enrollment_token);
        StatusCode::UNAUTHORIZED
    })?;

    // HARDENING: Check token expiry
    if let Some(expiry) = org_info.token_expiry {
        if Utc::now() > expiry {
            tracing::warn!("Enrollment attempt with expired token for Org: {}", org_info.name);
            return Err(StatusCode::UNAUTHORIZED);
        }
    }

    // HARDENING: Check max agents
    let current_count = org_info.current_agents;
    let max_agents = org_info.max_agents.unwrap_or(1000);
    if current_count >= max_agents as i64 {
        tracing::warn!("Enrollment blocked: Org {} reached limit of {} agents", org_info.name, max_agents);
        return Err(StatusCode::FORBIDDEN);
    }

    // 2. Enroll agent (Insert or update seen timestamp)
    let mut tx = pool.begin().await.map_err(|e| {
        tracing::error!("Enrollment: Failed to start transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    sqlx::query!(
        r#"
        INSERT INTO agents (id, organization_id, agent_id, hardware_fingerprint, hostname, last_seen, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (agent_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at,
            last_seen = EXCLUDED.last_seen,
            hostname = EXCLUDED.hostname
        "#,
        Uuid::new_v4(),
        org_info.id,
        payload.agent_id,
        payload.hardware_fingerprint,
        payload.hostname,
        Utc::now(),
        Utc::now(),
        Utc::now()
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Enrollment: Failed to insert/update agent: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Audit Log for Enrollment
    log_audit(
        &mut tx,
        ActorType::System, // Enrollment is a SYSTEM action authorized by a token
        None, 
        Some(org_info.id),
        "AGENT_ENROLLED",
        "AGENT",
        Some(payload.agent_id.clone()),
        serde_json::json!({ 
            "hostname": payload.hostname,
            "fingerprint": payload.hardware_fingerprint 
        }),
        None, // IP TODO: Extract from headers if possible (needs request parts)
        None
    ).await.map_err(|e| {
        tracing::error!("Enrollment: Failed to audit log: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Enrollment: Failed to commit transaction: {}", e);
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
        SET last_seen = $1, updated_at = $2, hostname = COALESCE($3, hostname)
        WHERE agent_id = $4 AND organization_id = $5
        "#,
        heartbeat.timestamp,
        Utc::now(),
        heartbeat.hostname,
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
        SELECT id, organization_id, agent_id, hardware_fingerprint, hostname, last_seen, created_at, updated_at
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
                "hostname": row.get::<Option<String>, _>("hostname"),
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

