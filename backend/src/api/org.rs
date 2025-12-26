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
