use tracing::info;
use axum::{
    extract::{State, Query},
    http::StatusCode,
    Json,
};
use crate::AppState;
use crate::api::auth::Claims;
use crate::db::models::{Organization, ActorType, EnrichedAuditLog};
use uuid::Uuid;
use chrono::Utc;
use serde::Serialize;
use crate::api::admin::{PlatformStats, AuditLogQuery};

#[derive(Debug, Serialize)]
pub struct OrgStats {
    pub total_agents: i64,
    pub active_last_24h: i64,
}

pub async fn get_current_org(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<Organization>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    
    let pool = state.db.pool();
    let org = sqlx::query_as!(
        Organization,
        r#"SELECT id, name, enrollment_token, status, COALESCE(max_agents, 1000) as "max_agents!", token_expiry, created_at, updated_at FROM organizations WHERE id = $1"#,
        org_id
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch current org: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(org))
}

pub async fn get_org_stats(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<OrgStats>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let pool = state.db.pool();

    let agent_count = sqlx::query!("SELECT COUNT(*) FROM agents WHERE organization_id = $1 AND deleted_at IS NULL", org_id)
        .fetch_one(pool)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .count
        .unwrap_or(0);

    let active_count = sqlx::query!(
        "SELECT COUNT(*) FROM agents WHERE organization_id = $1 AND last_seen > $2 AND deleted_at IS NULL",
        org_id,
        Utc::now() - chrono::Duration::hours(24)
    )
    .fetch_one(pool)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .count
    .unwrap_or(0);

    Ok(Json(OrgStats {
        total_agents: agent_count,
        active_last_24h: active_count,
    }))
}

pub async fn list_org_audit_logs(
    claims: Claims,
    State(state): State<AppState>,
    Query(params): Query<AuditLogQuery>,
) -> Result<Json<Vec<EnrichedAuditLog>>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let pool = state.db.pool();
    let limit = params.limit.unwrap_or(100);
    let offset = params.offset.unwrap_or(0);

    let logs = sqlx::query_as!(
        EnrichedAuditLog,
        r#"
        SELECT l.id, l.timestamp, l.actor_type as "actor_type: ActorType", l.actor_id, l.organization_id, 
               l.action_type, l.target_type, l.target_id, l.metadata, l.ip_address, l.user_agent,
               u.email as "actor_email?", u.full_name as "actor_name?"
        FROM audit_logs l
        LEFT JOIN users u ON l.actor_id = u.id
        WHERE l.organization_id = $1
          AND ($2::text IS NULL OR l.action_type = $2)
          AND ($3::text IS NULL OR l.target_type = $3)
          AND ($4::timestamptz IS NULL OR l.timestamp >= $4)
          AND ($5::timestamptz IS NULL OR l.timestamp <= $5)
        ORDER BY l.timestamp DESC
        LIMIT $6 OFFSET $7
        "#,
        org_id,
        params.action_type,
        params.target_type,
        params.start_time,
        params.end_time,
        limit,
        offset
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list org audit logs: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(logs))
}

use rand::Rng;
use sha2::Digest;
use axum::extract::Path;
use crate::db::models::{CreateEnrollmentToken, EnrollmentTokenResponse, EnrollmentToken};

pub async fn create_enrollment_token(
    claims: Claims,
    State(state): State<AppState>,
    Json(payload): Json<CreateEnrollmentToken>,
) -> Result<Json<EnrollmentTokenResponse>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    
    // Generate a secure random raw token
    let random_bytes: [u8; 32] = rand::thread_rng().gen();
    let raw_token = format!("rav-{}", hex::encode(random_bytes));

    // Hash the token
    let mut hasher = sha2::Sha256::new();
    sha2::Digest::update(&mut hasher, raw_token.as_bytes());
    let token_hash = hex::encode(hasher.finalize());

    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let token_id = Uuid::new_v4();
    let now = Utc::now();

    sqlx::query!(
        r#"
        INSERT INTO enrollment_tokens (token_id, org_id, token_hash, label, max_agents, expires_at, created_by, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
        token_id,
        org_id,
        token_hash,
        payload.label,
        payload.max_agents,
        payload.expires_at,
        claims.sub,
        now
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create token: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    crate::services::audit::log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        "TOKEN_CREATED",
        "ENROLLMENT_TOKEN",
        Some(token_id.to_string()),
        serde_json::json!({ "label": payload.label }),
        None, None
    ).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(EnrollmentTokenResponse {
        token_id,
        raw_token: Some(raw_token), // Only return this ONCE!
        label: payload.label,
        max_agents: payload.max_agents,
        expires_at: payload.expires_at,
    }))
}

pub async fn list_enrollment_tokens(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<Vec<EnrollmentToken>>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let tokens = sqlx::query_as!(
        EnrollmentToken,
        r#"
        SELECT token_id, org_id, label, max_agents, expires_at, revoked, created_at 
        FROM enrollment_tokens 
        ORDER BY created_at DESC
        "#
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list tokens: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(tokens))
}

pub async fn revoke_enrollment_token(
    claims: Claims,
    State(state): State<AppState>,
    Path(token_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result = sqlx::query!(
        "UPDATE enrollment_tokens SET revoked = true, revoked_at = NOW() WHERE token_id = $1 AND revoked = false",
        token_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to revoke token: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    crate::services::audit::log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        "TOKEN_REVOKED",
        "ENROLLMENT_TOKEN",
        Some(token_id.to_string()),
        serde_json::json!({}),
        None, None
    ).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(StatusCode::OK)
}

