use tracing::info;
use axum::{
    extract::{State, Path},
    http::StatusCode,
    Json,
};
use crate::AppState;
use crate::api::auth::Claims;
use crate::db::models::{Organization, ActorType, EnrichedAuditLog};
use crate::services::audit::log_audit;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;
use axum::extract::Query;

#[derive(Debug, Deserialize)]
pub struct CreateOrganization {
    pub name: String,
    pub admin_email: String,
    pub token_expiry: Option<chrono::DateTime<Utc>>,
    pub max_agents: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateStatus {
    pub status: String,
}

#[derive(Debug, Serialize)]
pub struct CreateOrgResponse {
    pub organization: Organization,
    pub admin_email: String,
    pub temporary_password: Option<String>,
}

pub async fn list_organizations(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    info!("List organizations request from user: {} (role: {})", claims.sub, claims.role);
    if claims.role != "super_admin" {
        info!("Access denied: user {} has role {}, expected super_admin", claims.sub, claims.role);
        return Err(StatusCode::FORBIDDEN);
    }

    let pool = state.db.pool();

    let orgs = sqlx::query(
        r#"SELECT id, name, enrollment_token, status, COALESCE(max_agents, 1000) as "max_agents", token_expiry, created_at, updated_at FROM organizations ORDER BY created_at DESC"#
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list organizations: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let result: Vec<serde_json::Value> = orgs
        .into_iter()
        .map(|row| {
            use sqlx::Row;
            let created_at = row.get::<chrono::DateTime<Utc>, _>("created_at");
            let token_expiry = row.get::<Option<chrono::DateTime<Utc>>, _>("token_expiry");

            serde_json::json!({
                "id": row.get::<Uuid, _>("id"),
                "name": row.get::<String, _>("name"),
                "enrollment_token": row.get::<String, _>("enrollment_token"),
                "max_agents": row.get::<i32, _>("max_agents"),
                "token_expiry": token_expiry,
                "created_at": created_at,
                "created_at_ms": created_at.timestamp_millis(),
                "status": if let Some(expiry) = token_expiry {
                    if expiry < Utc::now() {
                        "expired".to_string()
                    } else {
                        row.get::<String, _>("status")
                    }
                } else {
                    row.get::<String, _>("status")
                },
                "updated_at": row.get::<chrono::DateTime<Utc>, _>("updated_at")
            })
        })
        .collect();

    Ok(Json(result))
}


pub async fn create_organization(
    claims: Claims,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrganization>,
) -> Result<Json<CreateOrgResponse>, StatusCode> {
    info!("Create organization '{}' request from user: {} (role: {})", payload.name, claims.sub, claims.role);
    if claims.role != "super_admin" {
        info!("Access denied: user {} has role {}, expected super_admin", claims.sub, claims.role);
        return Err(StatusCode::FORBIDDEN);
    }

    let pool = state.db.pool();
    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Failed to start bypass transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // We no longer use this token, but we insert a dummy one because the schema still requires it
    let dummy_token = format!("legacy-{}", Uuid::new_v4());

    let org = sqlx::query_as!(
        Organization,
        r#"
        INSERT INTO organizations (id, name, enrollment_token, max_agents, token_expiry)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, name, enrollment_token, status, COALESCE(max_agents, 1000) as "max_agents!", token_expiry, created_at, updated_at, admin_verified
        "#,
        Uuid::new_v4(),
        payload.name,
        dummy_token,
        payload.max_agents.unwrap_or(1000),
        payload.token_expiry
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create organization: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Auto-generate temporary password for the Org Admin
    use rand::{Rng, thread_rng};
    use rand::distributions::Alphanumeric;
    
    let temp_password: String = thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();

    let password_hash = bcrypt::hash(&temp_password, 10).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_id = Uuid::new_v4();
    sqlx::query!(
        r#"
        INSERT INTO users (id, organization_id, email, password_hash, role, status, created_at, updated_at, must_change_password)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
        "#,
        user_id,
        org.id,
        payload.admin_email,
        password_hash,
        "org_admin",
        "active",
        Utc::now(),
        Utc::now()
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create org admin user: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    log_audit(
        &mut tx,
        ActorType::SuperAdmin,
        Some(claims.sub),
        None, // Global action
        "ORG_CREATED",
        "ORGANIZATION",
        Some(org.id.to_string()),
        serde_json::json!({ "name": org.name, "admin_email": payload.admin_email }),
        None, None
    ).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(CreateOrgResponse {
        organization: org,
        admin_email: payload.admin_email,
        temporary_password: Some(temp_password),
    }))
}

#[derive(Debug, Deserialize)]
pub struct UpdateOrganization {
    pub name: Option<String>,
    pub max_agents: Option<i32>,
    pub token_expiry: Option<chrono::DateTime<Utc>>,
    pub status: Option<String>,
}

pub async fn update_organization(
    claims: Claims,
    State(state): State<AppState>,
    Path(org_id): Path<Uuid>,
    Json(payload): Json<UpdateOrganization>,
) -> Result<Json<Organization>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let pool = state.db.pool();
    
    // Dynamic query update is cleaner, but for now simple coalesce is fine
    let org = sqlx::query_as!(
        Organization,
        r#"
        UPDATE organizations
        SET 
            name = COALESCE($1, name),
            max_agents = COALESCE($2, max_agents),
            token_expiry = COALESCE($3, token_expiry),
            status = COALESCE($4, status),
            updated_at = $5
        WHERE id = $6
        RETURNING id, name, enrollment_token, status, COALESCE(max_agents, 1000) as "max_agents!", token_expiry, created_at, updated_at, admin_verified
        "#,
        payload.name,
        payload.max_agents,
        payload.token_expiry,
        payload.status,
        Utc::now(),
        org_id
    )
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update organization: {}", e);
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
    info!("Platform stats request from user: {} (role: {})", claims.sub, claims.role);
    if claims.role != "super_admin" {
        info!("Access denied: user {} has role {}, expected super_admin", claims.sub, claims.role);
        return Err(StatusCode::FORBIDDEN);
    }

    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    let org_count = sqlx::query!("SELECT COUNT(*) FROM organizations")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .count
        .unwrap_or(0);

    let agent_count = sqlx::query!("SELECT COUNT(*) FROM agents WHERE deleted_at IS NULL")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .count
        .unwrap_or(0);

    let active_count = sqlx::query!(
        "SELECT COUNT(*) FROM agents WHERE last_seen > $1 AND deleted_at IS NULL",
        Utc::now() - chrono::Duration::hours(24)
    )
    .fetch_one(&mut *tx)
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
    info!("System health request from user: {} (role: {})", claims.sub, claims.role);
    if claims.role != "super_admin" {
        info!("Access denied: user {} has role {}, expected super_admin", claims.sub, claims.role);
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

pub async fn delete_organization(
    claims: Claims,
    State(state): State<AppState>,
    Path(org_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    info!("Delete organization '{}' request from user: {} (role: {})", org_id, claims.sub, claims.role);
    if claims.role != "super_admin" {
        info!("Access denied: user {} has role {}, expected super_admin", claims.sub, claims.role);
        return Err(StatusCode::FORBIDDEN);
    }

    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Log audit BEFORE deleting (but inside transaction)
    log_audit(
        &mut tx,
        ActorType::SuperAdmin,
        Some(claims.sub),
        None,
        "ORG_DELETED",
        "ORGANIZATION",
        Some(org_id.to_string()),
        serde_json::json!({ "org_id": org_id }),
        None,
        None
    ).await.map_err(|e| {
        tracing::error!("Failed to audit log: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Cascading delete - clean up everything associated with this org
    // 1. Delete events
    sqlx::query!("DELETE FROM events WHERE organization_id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete organization events: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 2. Delete files
    sqlx::query!("DELETE FROM files WHERE organization_id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete organization files: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 3. Delete archives (FK: archives_organization_id_fkey)
    sqlx::query!("DELETE FROM archives WHERE organization_id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete organization archives: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 4. Delete organization settings (FK: organization_settings_organization_id_fkey)
    sqlx::query!("DELETE FROM organization_settings WHERE organization_id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete organization settings: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 5. Delete agents (clears agents.enrollment_token_id FK refs)
    sqlx::query!("DELETE FROM agents WHERE organization_id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete organization agents: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 6. Delete enrollment_attempts for this org's tokens (FK to enrollment_tokens, NO ACTION).
    //    enrollment_rules cascade automatically via ON DELETE CASCADE in migration 013.
    sqlx::query!(
        "DELETE FROM enrollment_attempts WHERE token_id IN (SELECT token_id FROM enrollment_tokens WHERE org_id = $1)",
        org_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to delete enrollment attempts: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // 7. Delete enrollment_tokens (FK to organizations(id) and to users(id) via created_by).
    sqlx::query!("DELETE FROM enrollment_tokens WHERE org_id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete enrollment tokens: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 8. Delete deletion_requests (FK to organizations(id) and to users(id) via requested_by/cancelled_by).
    sqlx::query!("DELETE FROM deletion_requests WHERE org_id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete deletion requests: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 9. Delete users
    sqlx::query!("DELETE FROM users WHERE organization_id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete organization users: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // 10. Delete organization
    let result = sqlx::query!("DELETE FROM organizations WHERE id = $1", org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete organization: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(StatusCode::OK)
}

pub async fn restore_organization_data(
    claims: Claims,
    State(state): State<AppState>,
    Path(org_id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    // Transaction for atomic restoration with bypass
    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Failed to start transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // 1. Restore Agents
    let agents_restored = sqlx::query!(
        "UPDATE agents SET deleted_at = NULL WHERE organization_id = $1 AND deleted_at IS NOT NULL",
        org_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to restore agents: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .rows_affected();

    // 2. Restore Events
    let events_restored = sqlx::query!(
        "UPDATE events SET deleted_at = NULL WHERE organization_id = $1 AND deleted_at IS NOT NULL",
        org_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to restore events: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .rows_affected();

    // 3. Restore Files
    let files_restored = sqlx::query!(
        "UPDATE files SET deleted_at = NULL WHERE organization_id = $1 AND deleted_at IS NOT NULL",
        org_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to restore files: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .rows_affected();

    log_audit(
        &mut tx,
        ActorType::SuperAdmin,
        Some(claims.sub),
        None,
        "DATA_RESTORED",
        "ORGANIZATION",
        Some(org_id.to_string()),
        serde_json::json!({
            "restored_agents": agents_restored,
            "restored_events": events_restored,
            "restored_files": files_restored
        }),
        None,
        None
    ).await.map_err(|e| {
        tracing::error!("Failed to audit log: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(serde_json::json!({
        "status": "success",
        "restored": {
            "agents": agents_restored,
            "events": events_restored,
            "files": files_restored
        }
    })))
}

#[derive(Debug, Deserialize)]
pub struct AuditLogQuery {
    pub organization_id: Option<Uuid>,
    pub actor_type: Option<String>,
    pub action_type: Option<String>,
    pub target_type: Option<String>,
    pub start_time: Option<chrono::DateTime<Utc>>,
    pub end_time: Option<chrono::DateTime<Utc>>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

// ── Reset an org_admin's password ───────────────────────────────────────
//
// Lets a super_admin set an exact new password for any org_admin under
// any org. Used when an org_admin forgets their creds and the operator
// wants to hand them a specific new one (as opposed to auto-generating
// a temp password, which the org-creation flow already does).
//
// Body: { new_password: String }  (min 8 chars, matches change_password rule)
// Path: /api/v1/admin/organizations/:org_id/admins/:user_id/reset-password
//
// Also clears must_change_password so the admin lands on the dashboard,
// not the reset-password screen — because this IS the password the
// super_admin gave them intentionally.

#[derive(Debug, Serialize)]
pub struct OrgAdminSummary {
    pub id: Uuid,
    pub email: String,
    pub full_name: Option<String>,
    pub status: String,
    pub must_change_password: bool,
}

pub async fn list_org_admins(
    claims: Claims,
    State(state): State<AppState>,
    Path(org_id): Path<Uuid>,
) -> Result<Json<Vec<OrgAdminSummary>>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Failed to start bypass transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let rows = sqlx::query(
        r#"
        SELECT id, email, full_name, status, must_change_password
        FROM users
        WHERE organization_id = $1 AND role = 'org_admin'
        ORDER BY created_at ASC
        "#,
    )
    .bind(org_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list org_admins for {}: {}", org_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let admins: Vec<OrgAdminSummary> = rows
        .into_iter()
        .map(|row| {
            use sqlx::Row;
            OrgAdminSummary {
                id: row.get("id"),
                email: row.get("email"),
                full_name: row.get("full_name"),
                status: row.get("status"),
                must_change_password: row.get("must_change_password"),
            }
        })
        .collect();

    Ok(Json(admins))
}

#[derive(Debug, Deserialize)]
pub struct ResetAdminPassword {
    pub new_password: String,
}

#[derive(Debug, Serialize)]
pub struct ResetAdminPasswordResponse {
    pub ok: bool,
    pub email: String,
}

pub async fn reset_org_admin_password(
    claims: Claims,
    State(state): State<AppState>,
    Path((org_id, user_id)): Path<(Uuid, Uuid)>,
    Json(payload): Json<ResetAdminPassword>,
) -> Result<Json<ResetAdminPasswordResponse>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }
    if payload.new_password.len() < 8 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let new_hash = bcrypt::hash(&payload.new_password, 10)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Failed to start bypass transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Guarded UPDATE — must match BOTH org_id (from URL) AND role='org_admin'
    // so a bad user_id can't accidentally rewrite some other tenant's user.
    let row = sqlx::query(
        r#"
        UPDATE users
        SET password_hash = $1,
            must_change_password = FALSE,
            updated_at = NOW()
        WHERE id = $2
          AND organization_id = $3
          AND role = 'org_admin'
        RETURNING email
        "#,
    )
    .bind(&new_hash)
    .bind(user_id)
    .bind(org_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to reset org_admin password: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::NOT_FOUND)?;

    use sqlx::Row;
    let email: String = row.get("email");

    log_audit(
        &mut tx,
        ActorType::SuperAdmin,
        Some(claims.sub),
        Some(org_id),
        "USER_PASSWORD_RESET",
        "USER",
        Some(user_id.to_string()),
        serde_json::json!({ "target_email": email, "reset_by": "super_admin" }),
        None,
        None,
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to audit-log password reset: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit password reset: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ResetAdminPasswordResponse { ok: true, email }))
}

pub async fn list_audit_logs(
    claims: Claims,
    State(state): State<AppState>,
    Query(params): Query<AuditLogQuery>,
) -> Result<Json<Vec<EnrichedAuditLog>>, StatusCode> {
    if claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let pool = state.db.pool();
    let limit = params.limit.unwrap_or(100);
    let offset = params.offset.unwrap_or(0);

    // Coerce empty-string filters to None so `?action_type=` from clients
    // that spread all form state doesn't SQL-match the empty string and
    // silently empty the ledger. Same defensive coercion applied to
    // list_org_audit_logs.
    let action_type = params.action_type.as_deref().filter(|s| !s.is_empty()).map(str::to_string);
    let target_type = params.target_type.as_deref().filter(|s| !s.is_empty()).map(str::to_string);

    let logs = sqlx::query_as!(
        EnrichedAuditLog,
        r#"
        SELECT l.id, l.timestamp, l.actor_type as "actor_type: ActorType", l.actor_id, l.organization_id,
               l.action_type, l.target_type, l.target_id, l.metadata, l.ip_address, l.user_agent,
               u.email as "actor_email?", u.full_name as "actor_name?"
        FROM audit_logs l
        LEFT JOIN users u ON l.actor_id = u.id
        WHERE ($1::uuid IS NULL OR l.organization_id = $1)
          AND ($2::text IS NULL OR l.action_type = $2)
          AND ($3::text IS NULL OR l.target_type = $3)
          AND ($4::timestamptz IS NULL OR l.timestamp >= $4)
          AND ($5::timestamptz IS NULL OR l.timestamp <= $5)
        ORDER BY l.timestamp DESC
        LIMIT $6 OFFSET $7
        "#,
        params.organization_id,
        action_type,
        target_type,
        params.start_time,
        params.end_time,
        limit,
        offset
    )
    .fetch_all(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list audit logs: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(logs))
}
