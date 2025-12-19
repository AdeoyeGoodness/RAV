use axum::{
    extract::{State, Path},
    http::StatusCode,
    Json,
};
use crate::AppState;
use crate::api::auth::Claims;
use crate::db::models::Organization;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Deserialize)]
pub struct CreateOrganization {
    pub name: String,
    pub license_key: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStatus {
    pub status: String,
}

pub async fn list_organizations(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<Vec<Organization>>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let pool = state.db.pool();
    let orgs = sqlx::query_as!(
        Organization,
        "SELECT id, name, license_key, status, created_at, updated_at FROM organizations ORDER BY created_at DESC"
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list organizations: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(orgs))
}

pub async fn create_organization(
    claims: Claims,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrganization>,
) -> Result<Json<Organization>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let pool = state.db.pool();
    let org = sqlx::query_as!(
        Organization,
        r#"
        INSERT INTO organizations (id, name, license_key)
        VALUES ($1, $2, $3)
        RETURNING id, name, license_key, status, created_at, updated_at
        "#,
        Uuid::new_v4(),
        payload.name,
        payload.license_key
    )
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create organization: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(org))
}

pub async fn update_organization_status(
    claims: Claims,
    State(state): State<AppState>,
    Path(org_id): Path<Uuid>,
    Json(payload): Json<UpdateStatus>,
) -> Result<StatusCode, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let pool = state.db.pool();
    sqlx::query!(
        "UPDATE organizations SET status = $1, updated_at = $2 WHERE id = $3",
        payload.status,
        Utc::now(),
        org_id
    )
    .execute(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update organization status: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(StatusCode::OK)
}
#[derive(Debug, Serialize)]
pub struct PlatformStats {
    pub total_organizations: i64,
    pub total_agents: i64,
    pub active_last_24h: i64,
}

pub async fn get_platform_stats(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<PlatformStats>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let pool = state.db.pool();
    
    let org_count = sqlx::query!("SELECT COUNT(*) FROM organizations")
        .fetch_one(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .count
        .unwrap_or(0);

    let agent_count = sqlx::query!("SELECT COUNT(*) FROM agents WHERE deleted_at IS NULL")
        .fetch_one(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .count
        .unwrap_or(0);

    let active_count = sqlx::query!(
        "SELECT COUNT(*) FROM agents WHERE last_seen > $1 AND deleted_at IS NULL",
        Utc::now() - chrono::Duration::hours(24)
    )
    .fetch_one(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .count
    .unwrap_or(0);

    Ok(Json(PlatformStats {
        total_organizations: org_count,
        total_agents: agent_count,
        active_last_24h: active_count,
    }))
}
#[derive(Debug, Serialize)]
pub struct SystemHealth {
    pub status: String,
    pub uptime_seconds: i64,
    pub cpu_load: f32,
    pub database_connected: bool,
    pub orchestrator_version: String,
}

pub async fn get_system_health(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<SystemHealth>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let uptime = Utc::now() - state.server_start_time;
    let pool = state.db.pool();
    
    // Check DB connection
    let db_connected = sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .is_ok();

    // Mock CPU load with some jitter for visual effect
    // In a real prod environment we'd use sysinfo crate
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let cpu_load: f32 = rng.gen_range(5.0..15.0);

    Ok(Json(SystemHealth {
        status: "STABLE".to_string(),
        uptime_seconds: uptime.num_seconds(),
        cpu_load,
        database_connected: db_connected,
        orchestrator_version: env!("CARGO_PKG_VERSION").to_string(),
    }))
}
