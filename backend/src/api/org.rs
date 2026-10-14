use tracing::info;
use axum::{
    extract::{State, Query, Path},
    http::StatusCode,
    Json,
};
use crate::AppState;
use crate::api::auth::Claims;
use crate::db::models::{Organization, ActorType, EnrichedAuditLog};
use crate::services::audit::log_audit;
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
    let limit = params.limit.unwrap_or(100);
    let offset = params.offset.unwrap_or(0);

    // Coerce empty-string filters to None so `?action_type=` from a client
    // that forwards blanks (axios spreads {} verbatim) doesn't match the
    // literal empty string in SQL and silently empty the whole table.
    let action_type = params.action_type.as_deref().filter(|s| !s.is_empty()).map(str::to_string);
    let target_type = params.target_type.as_deref().filter(|s| !s.is_empty()).map(str::to_string);

    // BYPASS tx — the users table has FORCE RLS so the LEFT JOIN would drop
    // actor_email under a per-org tx (the current session sees org-scoped
    // users but the JOIN condition doesn't force the row into policy scope).
    // Explicit WHERE organization_id = $1 keeps this org-scoped in effect.
    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
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
        action_type,
        target_type,
        params.start_time,
        params.end_time,
        limit,
        offset
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to list org audit logs: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(logs))
}

use rand::Rng;
use sha2::Digest;
use crate::db::models::{CreateEnrollmentToken, EnrollmentTokenResponse, EnrollmentToken, UpdateEnrollmentToken};

pub async fn create_enrollment_token(
    claims: Claims,
    State(state): State<AppState>,
    Json(payload): Json<CreateEnrollmentToken>,
) -> Result<Json<EnrollmentTokenResponse>, (StatusCode, Json<serde_json::Value>)> {
    let err = |status: StatusCode, msg: &str| -> (StatusCode, Json<serde_json::Value>) {
        (status, Json(serde_json::json!({ "message": msg })))
    };
    let internal = || err(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error.");

    // Role gate — analysts (role='user') can browse tokens but can't mint them.
    if let Err(status) = require_org_admin(&claims) {
        return Err(err(status, "Forbidden."));
    }
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
    require_org_admin(&claims)?;
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

/// Edit an existing (non-revoked) enrollment token's label, max_agents, and/or
/// expiry. Raising max_agents is validated against the org ceiling the same way
/// creation is, except THIS token's own current allocation is excluded from the
/// committed total — so a token can be raised into the remaining headroom without
/// being charged twice for the slots it already holds.
pub async fn update_enrollment_token(
    claims: Claims,
    State(state): State<AppState>,
    Path(token_id): Path<Uuid>,
    Json(payload): Json<UpdateEnrollmentToken>,
) -> Result<Json<EnrollmentToken>, (StatusCode, Json<serde_json::Value>)> {
    let err = |status: StatusCode, msg: &str| -> (StatusCode, Json<serde_json::Value>) {
        (status, Json(serde_json::json!({ "message": msg })))
    };
    let internal = || err(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error.");

    if let Err(status) = require_org_admin(&claims) {
        return Err(err(status, "Forbidden."));
    }
    let org_id = claims.org_id.ok_or_else(|| err(StatusCode::UNAUTHORIZED, "Unauthorized."))?;

    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|_| internal())?;

    // Token must exist, belong to this org, and not be revoked.
    let existing = sqlx::query!(
        "SELECT revoked FROM enrollment_tokens WHERE token_id = $1 AND org_id = $2",
        token_id, org_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| internal())?
    .ok_or_else(|| err(StatusCode::NOT_FOUND, "Token not found."))?;
    if existing.revoked {
        return Err(err(StatusCode::BAD_REQUEST, "A revoked token cannot be edited."));
    }

    // Validate a new cap against the org ceiling, excluding this token's own slots.
    if let Some(requested_max) = payload.max_agents {
        if requested_max < 1 {
            return Err(err(StatusCode::BAD_REQUEST, "Max enrollments must be at least 1."));
        }
        let org = sqlx::query!(
            "SELECT COALESCE(max_agents, 1000) as max_agents FROM organizations WHERE id = $1",
            org_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| internal())?;
        let org_max = org.max_agents.unwrap_or(1000);

        let allocated_by_others = sqlx::query!(
            r#"
            SELECT COALESCE(SUM(max_agents), 0)::bigint AS "allocated!"
            FROM enrollment_tokens
            WHERE org_id = $1 AND token_id <> $2 AND revoked = false
              AND (expires_at IS NULL OR expires_at > NOW())
            "#,
            org_id, token_id
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| internal())?
        .allocated;

        let remaining = (org_max as i64) - allocated_by_others;
        if (requested_max as i64) > remaining {
            return Err(err(
                StatusCode::BAD_REQUEST,
                &format!(
                    "Only {} of your organization's {} enrollment slots are available for this token.",
                    remaining.max(0), org_max
                ),
            ));
        }
    }

    // COALESCE keeps the current value for any field left out of the request.
    sqlx::query!(
        r#"
        UPDATE enrollment_tokens
        SET label = COALESCE($3, label),
            max_agents = COALESCE($4, max_agents),
            expires_at = COALESCE($5, expires_at)
        WHERE token_id = $1 AND org_id = $2 AND revoked = false
        "#,
        token_id, org_id, payload.label, payload.max_agents, payload.expires_at
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update token: {}", e);
        internal()
    })?;

    crate::services::audit::log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        "TOKEN_UPDATED",
        "ENROLLMENT_TOKEN",
        Some(token_id.to_string()),
        serde_json::json!({ "max_agents": payload.max_agents, "label": payload.label }),
        None, None
    ).await.map_err(|_| internal())?;

    // Return the updated row in the same shape list_enrollment_tokens uses.
    let updated = sqlx::query_as!(
        EnrollmentToken,
        r#"
        SELECT t.token_id, t.org_id, t.label, t.max_agents, t.expires_at, t.revoked, t.created_at,
               (SELECT COUNT(*) FROM agents a
                WHERE a.enrollment_token_id = t.token_id AND a.deleted_at IS NULL) AS "agent_count!"
        FROM enrollment_tokens t
        WHERE t.token_id = $1 AND t.org_id = $2
        "#,
        token_id, org_id
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| internal())?;

    tx.commit().await.map_err(|_| internal())?;
    Ok(Json(updated))
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
    require_org_admin(&claims)?;
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
    // Truncate the keyword text in the audit metadata — an oversized keyword
    // shouldn't blow up the audit row size.
    let audit_kw: String = keyword.chars().take(80).collect();
    log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        "KEYWORD_ADDED",
        "keyword",
        Some(row.0.to_string()),
        serde_json::json!({ "keyword": audit_kw, "is_regex": payload.is_regex, "files_rescheduled": rescheduled }),
        None, None,
    )
    .await
    .map_err(|e| { tracing::error!("audit KEYWORD_ADDED failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;
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
    require_org_admin(&claims)?;
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
    let mut audit_kw: Option<String> = None;
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
        audit_kw = Some(kw.chars().take(80).collect());
    }

    log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        "KEYWORD_DELETED",
        "keyword",
        Some(id.to_string()),
        serde_json::json!({ "keyword": audit_kw }),
        None, None,
    )
    .await
    .map_err(|e| { tracing::error!("audit KEYWORD_DELETED failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------------------
// Org user management (org_admin creates / manages read-only 'user' accounts
// inside their org). Single choke-point for role enforcement below.
// ---------------------------------------------------------------------------

/// Reject the request unless the caller is the tenant admin of the caller's
/// own org (org_admin) or the platform super_admin. The `user` role is
/// read-only across all endpoints — every mutating handler in this file
/// (and every mutating agent handler) must call this at the top.
pub fn require_org_admin(claims: &Claims) -> Result<(), StatusCode> {
    match claims.role.as_str() {
        "super_admin" | "org_admin" => Ok(()),
        _ => Err(StatusCode::FORBIDDEN),
    }
}

/// Generate a 16-character alphanumeric temporary password. Mirrors the
/// bootstrap flow used by admin::create_organization so an org_admin
/// onboarding a new analyst hands them a credential of the same shape.
fn generate_temp_password() -> String {
    use rand::{Rng, thread_rng};
    use rand::distributions::Alphanumeric;
    thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect()
}

#[derive(Debug, Serialize)]
pub struct OrgUserRow {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub status: String,
    pub must_change_password: bool,
    pub full_name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub password_changed_at: Option<DateTime<Utc>>,
}

/// List users under the caller's org. Read-only — accessible to any
/// authenticated org member (including the 'user' role). Passwords are
/// never returned; `password_hash` stays server-side.
pub async fn list_org_users(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<Vec<OrgUserRow>>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = sqlx::query_as::<_, (Uuid, String, String, String, bool, Option<String>, DateTime<Utc>, Option<DateTime<Utc>>)>(
        "SELECT id, email, role, status, must_change_password, full_name, created_at, password_changed_at
         FROM users
         WHERE organization_id = $1
         ORDER BY created_at DESC",
    )
    .bind(org_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| { tracing::error!("list_org_users failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(
        rows.into_iter()
            .map(|(id, email, role, status, must_change_password, full_name, created_at, password_changed_at)| OrgUserRow {
                id, email, role, status, must_change_password, full_name, created_at, password_changed_at,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize)]
pub struct CreateOrgUser {
    pub email: String,
    pub full_name: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CreateOrgUserResponse {
    pub id: Uuid,
    pub email: String,
    pub role: String,
    pub temporary_password: String,
}

/// Create a read-only 'user' account under the caller's org. Only org_admin
/// (and super_admin as a fall-through) can call this. Emits a temp password
/// that the UI reveals ONCE in a hand-off modal; the caller passes it to
/// the new user out-of-band. The user is stamped `must_change_password=true`
/// so the existing auth flow forces them into /reset-password on first
/// login before they can access anything else.
pub async fn create_org_user(
    claims: Claims,
    State(state): State<AppState>,
    Json(payload): Json<CreateOrgUser>,
) -> Result<Json<CreateOrgUserResponse>, StatusCode> {
    require_org_admin(&claims)?;
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;

    let email = payload.email.trim().to_lowercase();
    if email.is_empty() || !email.contains('@') || email.len() > 255 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let temp_password = generate_temp_password();
    let password_hash = bcrypt::hash(&temp_password, 10).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let user_id = Uuid::new_v4();
    let now = Utc::now();

    // users has FORCE RLS; BYPASS + explicit WHERE organization_id guard
    // (guard is on this INSERT via the direct org_id column value).
    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query(
        "INSERT INTO users (id, organization_id, email, password_hash, role, status, full_name, \
                            must_change_password, created_at, updated_at) \
         VALUES ($1, $2, $3, $4, 'user', 'active', $5, true, $6, $6)",
    )
    .bind(user_id)
    .bind(org_id)
    .bind(&email)
    .bind(&password_hash)
    .bind(&payload.full_name)
    .bind(now)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        // Postgres unique-violation on the email index = 23505; surface as 409.
        if let sqlx::Error::Database(db) = &e {
            if db.code().as_deref() == Some("23505") {
                return StatusCode::CONFLICT;
            }
        }
        tracing::error!("create_org_user insert failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        "USER_CREATED",
        "user",
        Some(user_id.to_string()),
        serde_json::json!({ "email": &email, "role": "user", "full_name": &payload.full_name }),
        None, None,
    )
    .await
    .map_err(|e| { tracing::error!("audit USER_CREATED failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    info!("Org {} created user {} ({}) role=user", org_id, email, user_id);

    Ok(Json(CreateOrgUserResponse {
        id: user_id,
        email,
        role: "user".to_string(),
        temporary_password: temp_password,
    }))
}

#[derive(Debug, Deserialize)]
pub struct SetOrgUserStatus {
    pub status: String, // "active" | "suspended"
}

/// Activate or suspend an org user. Can't touch org_admin or super_admin
/// rows (server-side guard + explicit WHERE role = 'user'). Prevents an
/// org_admin from locking themselves out or elevating anyone via this
/// endpoint.
pub async fn set_org_user_status(
    claims: Claims,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
    Json(payload): Json<SetOrgUserStatus>,
) -> Result<StatusCode, StatusCode> {
    require_org_admin(&claims)?;
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    if payload.status != "active" && payload.status != "suspended" {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let res = sqlx::query(
        "UPDATE users SET status = $1, updated_at = NOW() \
         WHERE id = $2 AND organization_id = $3 AND role = 'user'",
    )
    .bind(&payload.status)
    .bind(user_id)
    .bind(org_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| { tracing::error!("set_org_user_status failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;
    if res.rows_affected() == 0 {
        // Roll back nothing meaningful — nothing changed — and 404 out.
        return Err(StatusCode::NOT_FOUND);
    }
    let action = if payload.status == "suspended" { "USER_SUSPENDED" } else { "USER_ACTIVATED" };
    log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        action,
        "user",
        Some(user_id.to_string()),
        serde_json::json!({}),
        None, None,
    )
    .await
    .map_err(|e| { tracing::error!("audit {} failed: {}", action, e); StatusCode::INTERNAL_SERVER_ERROR })?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize)]
pub struct ResetPasswordResponse {
    pub temporary_password: String,
}

/// Admin-triggered password reset: regenerate a temp password and force the
/// user into /reset-password on their next login. Restricted to role='user'
/// rows in the caller's org.
pub async fn reset_org_user_password(
    claims: Claims,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<ResetPasswordResponse>, StatusCode> {
    require_org_admin(&claims)?;
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;

    let temp_password = generate_temp_password();
    let password_hash = bcrypt::hash(&temp_password, 10).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let res = sqlx::query(
        "UPDATE users SET password_hash = $1, must_change_password = true, updated_at = NOW() \
         WHERE id = $2 AND organization_id = $3 AND role = 'user'",
    )
    .bind(&password_hash)
    .bind(user_id)
    .bind(org_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| { tracing::error!("reset_org_user_password failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;
    if res.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        "USER_PASSWORD_RESET",
        "user",
        Some(user_id.to_string()),
        serde_json::json!({}),
        None, None,
    )
    .await
    .map_err(|e| { tracing::error!("audit USER_PASSWORD_RESET failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(ResetPasswordResponse { temporary_password: temp_password }))
}

/// Delete an org user. Hard delete — users is not soft-deleted in this
/// codebase (only agents are). Restricted to role='user' rows in the
/// caller's org, so org_admin rows can't be removed via this endpoint.
pub async fn delete_org_user(
    claims: Claims,
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    require_org_admin(&claims)?;
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Grab the email BEFORE delete so the audit row is legible after the
    // FK cascade wipes it. Only proceed if the user is in the caller's org
    // and is role='user' (org_admin rows never returned).
    let target_email: Option<String> = sqlx::query_scalar::<_, String>(
        "SELECT email FROM users WHERE id = $1 AND organization_id = $2 AND role = 'user'",
    )
    .bind(user_id)
    .bind(org_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let email = match target_email {
        Some(e) => e,
        None => return Err(StatusCode::NOT_FOUND),
    };

    let res = sqlx::query(
        "DELETE FROM users WHERE id = $1 AND organization_id = $2 AND role = 'user'",
    )
    .bind(user_id)
    .bind(org_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| { tracing::error!("delete_org_user failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;
    if res.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    log_audit(
        &mut tx,
        ActorType::OrgAdmin,
        Some(claims.sub),
        Some(org_id),
        "USER_DELETED",
        "user",
        Some(user_id.to_string()),
        serde_json::json!({ "email": email }),
        None, None,
    )
    .await
    .map_err(|e| { tracing::error!("audit USER_DELETED failed: {}", e); StatusCode::INTERNAL_SERVER_ERROR })?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
}
