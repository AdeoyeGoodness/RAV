use tracing::info;
use axum::{
    extract::{State, Query, Path},
    http::StatusCode,
    Json,
};
use crate::AppState;
use crate::api::auth::Claims;
use crate::db::models::{Organization, ActorType, EnrichedAuditLog};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
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
        r#"SELECT id, name, enrollment_token, status, COALESCE(max_agents, 1000) as "max_agents!", token_expiry, created_at, updated_at, admin_verified FROM organizations WHERE id = $1"#,
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
use crate::db::models::{CreateEnrollmentToken, EnrollmentTokenResponse, EnrollmentToken};

pub async fn create_enrollment_token(
    claims: Claims,
    State(state): State<AppState>,
    Json(payload): Json<CreateEnrollmentToken>,
) -> Result<Json<EnrollmentTokenResponse>, (StatusCode, Json<serde_json::Value>)> {
    let err = |status: StatusCode, msg: &str| -> (StatusCode, Json<serde_json::Value>) {
        (status, Json(serde_json::json!({ "message": msg })))
    };
    let internal = || err(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error.");

    let org_id = claims.org_id.ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Unauthorized."))?;

    // Generate a secure random raw token
    let random_bytes: [u8; 32] = rand::thread_rng().gen();
    let raw_token = format!("rav-{}", hex::encode(random_bytes));

    // Hash the token
    let mut hasher = sha2::Sha256::new();
    sha2::Digest::update(&mut hasher, raw_token.as_bytes());
    let token_hash = hex::encode(hasher.finalize());

    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|_| internal())?;

    let org = sqlx::query!(
        "SELECT COALESCE(max_agents, 1000) as max_agents FROM organizations WHERE id = $1",
        org_id
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| internal())?;

    let org_max = org.max_agents.unwrap_or(1000);
    let requested_max = payload.max_agents.ok_or_else(|| {
        err(StatusCode::BAD_REQUEST, "max_agents is required.")
    })?;
    if requested_max < 1 {
        return Err(err(StatusCode::BAD_REQUEST, "Max enrollments must be at least 1."));
    }

    // The org's max_agents is the hard ceiling on total provisionable agents, so a
    // new token can only claim the slots left after existing active (non-revoked,
    // non-expired) tokens' allocations are subtracted. Capping against org_max alone
    // let every token claim the full org limit, ignoring slots already handed out.
    let allocated = sqlx::query!(
        r#"
        SELECT COALESCE(SUM(max_agents), 0)::bigint AS "allocated!"
        FROM enrollment_tokens
        WHERE org_id = $1 AND revoked = false AND (expires_at IS NULL OR expires_at > NOW())
        "#,
        org_id
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| internal())?
    .allocated;

    let remaining = (org_max as i64) - allocated;
    if (requested_max as i64) > remaining {
        return Err(err(
            StatusCode::BAD_REQUEST,
            &format!(
                "Only {} of your organization's {} enrollment slots remain (the rest are already allocated to active tokens).",
                remaining.max(0), org_max
            ),
        ));
    }

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
        internal()
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
    ).await.map_err(|_| internal())?;

    tx.commit().await.map_err(|_| internal())?;

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

    // enrollment_tokens has no RLS policy (migration 014 skipped it), so the
    // WHERE org_id filter is the actual isolation guarantee here.
    let tokens = sqlx::query_as!(
        EnrollmentToken,
        r#"
        SELECT t.token_id, t.org_id, t.label, t.max_agents, t.expires_at, t.revoked, t.created_at,
               (SELECT COUNT(*) FROM agents a
                WHERE a.enrollment_token_id = t.token_id AND a.deleted_at IS NULL) AS "agent_count!"
        FROM enrollment_tokens t
        WHERE t.org_id = $1
        ORDER BY t.created_at DESC
        "#,
        org_id
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

    // enrollment_tokens has no RLS policy, so scope the UPDATE to the caller's
    // org explicitly — without this, any org_admin could revoke any token
    // system-wide by guessing the UUID.
    let result = sqlx::query!(
        "UPDATE enrollment_tokens SET revoked = true, revoked_at = NOW() WHERE token_id = $1 AND org_id = $2 AND revoked = false",
        token_id,
        org_id
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

// ============================================================================
// Sensitive-keyword CRUD (drives the OCR content-scanning pipeline).
// ============================================================================

#[derive(Debug, Serialize)]
pub struct KeywordRow {
    pub id: Uuid,
    pub organization_id: Option<Uuid>,
    pub keyword: String,
    pub is_regex: bool,
    pub is_global: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateKeyword {
    pub keyword: String,
    #[serde(default)]
    pub is_regex: bool,
}

/// List every keyword rule the caller's org sees — platform globals
/// (`organization_id IS NULL`) plus the org's own extras. RLS policy already
/// enforces the union, so a straight SELECT under the org-scoped tx is enough.
pub async fn list_keywords(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<Vec<KeywordRow>>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, bool, DateTime<Utc>)>(
        "SELECT id, organization_id, keyword, is_regex, created_at
         FROM sensitive_keywords
         ORDER BY organization_id IS NULL DESC, keyword ASC",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("list_keywords failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, organization_id, keyword, is_regex, created_at)| KeywordRow {
                id,
                organization_id,
                keyword,
                is_regex,
                is_global: organization_id.is_none(),
                created_at,
            })
            .collect(),
    ))
}

/// Add one org-scoped keyword. Globals are seeded at migration time and are
/// intentionally not creatable from the org UI — org admins can only extend
/// the list with their own terms.
pub async fn create_keyword(
    claims: Claims,
    State(state): State<AppState>,
    Json(payload): Json<CreateKeyword>,
) -> Result<Json<KeywordRow>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let keyword = payload.keyword.trim().to_string();
    if keyword.is_empty() || keyword.len() > 200 {
        return Err(StatusCode::BAD_REQUEST);
    }
    // Reject clearly-broken regex up front so admins see the failure at add
    // time, not silently during OCR scanning.
    if payload.is_regex {
        if regex::RegexBuilder::new(&keyword).case_insensitive(true).build().is_err() {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let row = sqlx::query_as::<_, (Uuid, Option<Uuid>, String, bool, DateTime<Utc>)>(
        "INSERT INTO sensitive_keywords (organization_id, keyword, is_regex)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, keyword) DO UPDATE SET is_regex = EXCLUDED.is_regex
         RETURNING id, organization_id, keyword, is_regex, created_at",
    )
    .bind(org_id)
    .bind(&keyword)
    .bind(payload.is_regex)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("create_keyword failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Reschedule every image in this org for re-scan so the new keyword takes
    // effect retroactively. OCR is idempotent — the background worker will
    // recompute matches against the current keyword list and update
    // is_critical accordingly.
    let rescheduled = sqlx::query(
        "UPDATE files
         SET ocr_status = 'pending', ocr_processed_at = NULL, ocr_error = NULL
         WHERE organization_id = $1 AND ocr_status IN ('done', 'failed')",
    )
    .bind(org_id)
    .execute(&mut *tx)
    .await
    .map(|r| r.rows_affected())
    .unwrap_or(0);
    if rescheduled > 0 {
        tracing::info!("Keyword '{}' added — rescheduled {} files for re-scan", keyword, rescheduled);
    }
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(KeywordRow {
        id: row.0,
        organization_id: row.1,
        keyword: row.2,
        is_regex: row.3,
        is_global: row.1.is_none(),
        created_at: row.4,
    }))
}

/// Delete one keyword. RLS + explicit org_id filter keep an org from touching
/// another org's row; globals (organization_id NULL) can't be deleted through
/// this endpoint at all.
pub async fn delete_keyword(
    claims: Claims,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Read the keyword text BEFORE deleting — we need it to find every file
    // that was flagged because of this term so we can reschedule those for a
    // fresh OCR pass. Without this the file keeps its stale `ocr_matches`
    // and its `is_critical=true` even after the rule that flagged it is gone.
    let keyword_text = sqlx::query_scalar::<_, String>(
        "SELECT keyword FROM sensitive_keywords WHERE id = $1 AND organization_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let res = sqlx::query(
        "DELETE FROM sensitive_keywords WHERE id = $1 AND organization_id = $2",
    )
    .bind(id)
    .bind(org_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("delete_keyword failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if res.rows_affected() == 0 {
        tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        return Err(StatusCode::NOT_FOUND);
    }

    // Reset every file that carried this keyword in its match list, so the
    // OCR worker picks them up on the next sweep and re-derives is_critical
    // from the CURRENT keyword catalog. Files flagged by other keywords too
    // will keep their critical status; files flagged ONLY by this one drop.
    if let Some(kw) = keyword_text {
        let rescheduled = sqlx::query(
            "UPDATE files
             SET ocr_status = 'pending',
                 ocr_matches = '{}',
                 is_critical = FALSE,
                 ocr_processed_at = NULL,
                 ocr_error = NULL
             WHERE organization_id = $1
               AND $2 = ANY(ocr_matches)",
        )
        .bind(org_id)
        .bind(&kw)
        .execute(&mut *tx)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
        if rescheduled > 0 {
            tracing::info!(
                "Keyword '{}' deleted — rescheduled {} files for re-scan",
                kw, rescheduled
            );
        }
    }

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}
