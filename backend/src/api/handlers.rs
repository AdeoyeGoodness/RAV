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
use sha2::Digest;

use crate::db::models::{CreateAgent, CreateEvent, Event, ActorType};
use crate::services::audit::log_audit;
use crate::api::auth::Claims;
use crate::AppState;

/// Pull caller IP + User-Agent off the request headers for audit logging. nginx is in front,
/// so the real client IP is in X-Forwarded-For (first hop); we fall back to X-Real-IP.
fn extract_request_meta(headers: &HeaderMap) -> (Option<String>, Option<String>) {
    let ip = headers
        .get("x-forwarded-for")
        .or_else(|| headers.get("x-real-ip"))
        .and_then(|h| h.to_str().ok())
        .map(|s| s.split(',').next().unwrap_or(s).trim().to_string());
    let user_agent = headers
        .get("user-agent")
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());
    (ip, user_agent)
}

/// Map a JWT role string to the audit ActorType enum (SuperAdmin / OrgAdmin / System).
fn actor_type_from_role(role: &str) -> ActorType {
    match role {
        "super_admin" => ActorType::SuperAdmin,
        _ => ActorType::OrgAdmin,
    }
}

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

#[derive(Debug, Deserialize)]
pub struct TestSmtpPayload {
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from_email: String,
}

#[derive(Debug, Deserialize)]
pub struct VerifyIdentityPayload {
    pub password: String,
}

pub async fn verify_identity(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<VerifyIdentityPayload>,
) -> Result<StatusCode, StatusCode> {
    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Failed to start bypass tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let user_row = sqlx::query!("SELECT password_hash FROM users WHERE id = $1", claims.sub)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Identity verify: DB query failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or_else(|| {
            tracing::warn!("Identity verify: User not found: {}", claims.sub);
            StatusCode::UNAUTHORIZED
        })?;

    if bcrypt::verify(&payload.password, &user_row.password_hash).map_err(|e| {
        tracing::error!("Identity verify: Bcrypt failure: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })? {
        Ok(StatusCode::OK)
    } else {
        tracing::warn!("Identity verify: Invalid password for user: {}", claims.sub);
        Err(StatusCode::UNAUTHORIZED)
    }
}

pub async fn ingest_events(
    State(state): State<AppState>,
    Json(events): Json<Vec<CreateEvent>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let events_count = events.len();

    if events.is_empty() {
        return Ok(Json(serde_json::json!({
            "status": "success",
            "events_ingested": 0
        })));
    }

    // Look up the agent's org in BYPASS mode (agents table has FORCE RLS from migration 014).
    let first_agent_id = &events[0].agent_id;
    let mut lookup_tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Ingest: Failed to begin bypass tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let org_id = sqlx::query!(
        "SELECT organization_id FROM agents WHERE agent_id = $1 AND deleted_at IS NULL",
        first_agent_id
    )
    .fetch_optional(&mut *lookup_tx)
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
    lookup_tx.commit().await.map_err(|e| {
        tracing::error!("Ingest: Failed to commit lookup tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Insert events under the resolved org's RLS context.
    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|e| {
        tracing::error!("Ingest: Failed to begin RLS tx for org {}: {}", org_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Telemetry is high-volume and agents buffer/retry, so this batch's COMMIT doesn't need to
    // block on a WAL fsync. Relax durability for THIS transaction only: a hard server crash can
    // drop at most the last sub-second of just-acknowledged events (only telemetry, nothing else).
    let _ = sqlx::query("SET LOCAL synchronous_commit = OFF")
        .execute(&mut *tx)
        .await;

    for event in events {
        // The agent doesn't send a category, so derive it from event_type. (Previously every
        // event was stored as "system", which made the dashboard's category bars read zero for
        // everything except browser.) Respect an explicit category if one is ever provided.
        let category = event
            .category
            .as_deref()
            .filter(|c| !c.is_empty() && *c != "system")
            .map(str::to_string)
            .unwrap_or_else(|| categorize_event(&event.event_type).to_string());

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
            category,
            Utc::now()
        )
        .execute(&mut *tx)
        .await;

        if let Err(e) = result {
            tracing::error!("Failed to insert event: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Ingest: Failed to commit event tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(serde_json::json!({
        "status": "success",
        "events_ingested": events_count,
        "organization_id": org_id
    })))
}

/// Map an event_type to a dashboard category. Mirrors report.rs `bucket()` but uses the lowercase
/// keys the dashboard filters on (network/process/browser/file/screenshot). Order matters —
/// first match wins (kept in sync with migration 016's backfill CASE).
fn categorize_event(event_type: &str) -> &'static str {
    let t = event_type.to_ascii_lowercase();
    if t.contains("screenshot") {
        "screenshot"
    } else if t.contains("usb") || t.contains("file_transfer") {
        "file"
    } else if t.contains("browser")
        || t.contains("history")
        || t.contains("active_tab")
        || t.contains("tab_updated")
        || t.contains("search")
        || t.contains("download")
    {
        "browser"
    } else if t.contains("network") || t.contains("connection") || t.contains("wifi") {
        "network"
    } else if t.contains("process") {
        "process"
    } else {
        "system"
    }
}

pub async fn query_events(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Query(params): Query<EventQuery>,
) -> Result<Json<Vec<Event>>, StatusCode> {

    // Determine org context and begin RLS-scoped transaction
    let mut tx = if claims.role == "super_admin" {
        // Super Admin: must provide X-Organization-Id header, or gets BYPASS
        if let Some(org_id) = headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
        {
            state.db.begin_rls_tx(org_id).await
        } else {
            state.db.begin_bypass_tx().await
        }
    } else {
        // Tenant users: locked to their JWT org_id
        let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
        state.db.begin_rls_tx(org_id).await
    }
    .map_err(|e| {
        tracing::error!("Failed to begin RLS transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Hard-cap to protect the connection pool: a runaway client asking for 10k rows used to
    // run for minutes per call (no upper bound + 12-col JSONB serialization), starving every
    // other endpoint. 1000 is more than any dashboard view should ever need in one request —
    // higher ranges must paginate.
    let limit = params.limit.unwrap_or(100).min(1000);

    // RLS policies automatically filter by organization — no need for org_id in WHERE
    let events = sqlx::query_as::<_, Event>(
        r#"
        SELECT id, organization_id, agent_id, event_type, timestamp, metadata, severity, category, deleted_at, observed, received_at, created_at 
        FROM events 
        WHERE ($1::text IS NULL OR agent_id = $1)
          AND ($2::text IS NULL OR event_type = $2)
          AND ($3::text IS NULL OR category = $3)
          AND ($4::text IS NULL OR severity = $4)
          AND ($5::timestamptz IS NULL OR timestamp >= $5)
          AND ($6::timestamptz IS NULL OR timestamp <= $6)
          AND deleted_at IS NULL 
        ORDER BY timestamp DESC 
        LIMIT $7
        "#
    )
    .bind(&params.agent_id)
    .bind(&params.event_type)
    .bind(&params.category)
    .bind(&params.severity)
    .bind(params.start_time)
    .bind(params.end_time)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to query events: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit RLS transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(events))
}

pub async fn enroll_agent(
    State(state): State<AppState>,
    Json(payload): Json<CreateAgent>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let pool = state.db.pool();

    // 1. Hash the incoming token
    let mut hasher = sha2::Sha256::new();
    sha2::Digest::update(&mut hasher, payload.enrollment_token.as_bytes());
    let token_hash = hex::encode(hasher.finalize());

    // 2. Look up token in the secure enrollment_tokens table.
    // Use a BYPASS tx so the agents subquery actually counts rows — agents has
    // FORCE ROW LEVEL SECURITY from migration 014, and the bare pool has no
    // app.current_org_id set, which would silently return 0 and let the per-token
    // max_agents check below pass for any number of enrollments.
    let mut lookup_tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Enrollment: Failed to begin bypass tx for token lookup: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let token_info = sqlx::query!(
        r#"
        SELECT t.token_id, t.org_id, t.max_agents, t.expires_at, t.revoked,
               o.name as org_name, o.status as org_status,
               COALESCE(o.max_agents, 1000) as "org_max_agents!",
               (SELECT COUNT(*) FROM agents WHERE enrollment_token_id = t.token_id AND deleted_at IS NULL) as "current_agents!",
               (SELECT COUNT(*) FROM agents WHERE organization_id = t.org_id AND deleted_at IS NULL) as "org_current_agents!",
               EXISTS(
                   SELECT 1 FROM agents
                   WHERE organization_id = t.org_id
                     AND hardware_fingerprint = $2
                     AND deleted_at IS NULL
               ) as "is_reinstall!"
        FROM enrollment_tokens t
        JOIN organizations o ON t.org_id = o.id
        WHERE t.token_hash = $1
        "#,
        token_hash,
        payload.hardware_fingerprint
    )
    .fetch_optional(&mut *lookup_tx)
    .await
    .map_err(|e| {
        tracing::error!("Enrollment: Failed to query token: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    lookup_tx.commit().await.map_err(|e| {
        tracing::error!("Enrollment: Failed to commit token lookup tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Helper to log rejection attempt before returning
    macro_rules! log_rejection {
        ($token_id:expr, $outcome:expr) => {
            let _ = sqlx::query!(
                r#"
                INSERT INTO enrollment_attempts 
                (token_id, machine_fingerprint, hostname, os_type, outcome)
                VALUES ($1, $2, $3, $4, $5)
                "#,
                $token_id,
                payload.hardware_fingerprint,
                payload.hostname,
                payload.os_version,
                $outcome
            )
            .execute(pool)
            .await;
        };
    }

    let token = match token_info {
        Some(t) => t,
        None => {
            tracing::warn!("Enrollment attempt with unknown token hash");
            log_rejection!(None as Option<Uuid>, "rejected_unknown");
            return Err(StatusCode::UNAUTHORIZED);
        }
    };

    if token.org_status != "active" {
        tracing::warn!("Enrollment attempt for inactive Org: {}", token.org_name);
        log_rejection!(Some(token.token_id), "rejected_org_inactive");
        return Err(StatusCode::UNAUTHORIZED);
    }

    if token.revoked {
        tracing::warn!("Enrollment attempt with revoked token for Org: {}", token.org_name);
        log_rejection!(Some(token.token_id), "rejected_revoked");
        return Err(StatusCode::UNAUTHORIZED);
    }

    // Expiry + capacity gates apply to NEW machines only. Reinstalls (same hardware_fingerprint
    // already enrolled in this org and not soft-deleted) bypass them, so an already-enrolled
    // agent keeps working and can re-establish its session even after its token expires — only
    // brand-new enrollments are blocked once the token is expired or at capacity. (Revoked and
    // inactive-org are checked above and block everyone, including reinstalls.)
    if !token.is_reinstall {
        if let Some(expiry) = token.expires_at {
            if Utc::now() > expiry {
                tracing::warn!("Enrollment attempt with expired token for Org: {}", token.org_name);
                log_rejection!(Some(token.token_id), "rejected_expired");
                return Err(StatusCode::UNAUTHORIZED);
            }
        }

        if token.org_current_agents >= token.org_max_agents as i64 {
            tracing::warn!(
                "Enrollment blocked: Org '{}' at agent cap ({}/{})",
                token.org_name, token.org_current_agents, token.org_max_agents
            );
            log_rejection!(Some(token.token_id), "rejected_org_max");
            return Err(StatusCode::FORBIDDEN);
        }

        if let Some(max_agents) = token.max_agents {
            if token.current_agents >= max_agents as i64 {
                tracing::warn!("Enrollment blocked: Token reached limit of {} agents", max_agents);
                log_rejection!(Some(token.token_id), "rejected_max");
                return Err(StatusCode::FORBIDDEN);
            }
        }
    }

    // Attempt is accepted, we will log 'enrolled' or 'reinstall' later


    // 2. Enroll agent (Insert or update seen timestamp).
    // Run in BYPASS, not an org-scoped tx: enrollment is a system action authorized by the token,
    // and the deterministic agent_id means a re-enrolled machine may already have an agents row
    // under a DIFFERENT org. agents has FORCE RLS (migration 014), so an org-scoped policy would
    // hide that conflicting row and make `ON CONFLICT (agent_id) DO UPDATE` fail with
    // "new row violates row-level security policy". BYPASS lets the upsert (and the audit/attempt
    // inserts) run; organization_id is still set explicitly from the validated token, so the agent
    // lands in the correct org. (The token lookup above already uses BYPASS for the same reason.)
    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Enrollment: Failed to start transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let insert_result = sqlx::query!(
        r#"
        INSERT INTO agents (id, organization_id, agent_id, hardware_fingerprint, hostname, last_seen, created_at, updated_at, enrollment_token_id, os_version, enrolled_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (agent_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at,
            last_seen = EXCLUDED.last_seen,
            hostname = EXCLUDED.hostname,
            hardware_fingerprint = EXCLUDED.hardware_fingerprint,
            organization_id = EXCLUDED.organization_id,
            enrollment_token_id = EXCLUDED.enrollment_token_id,
            os_version = EXCLUDED.os_version
        RETURNING (xmax = 0) AS "inserted!"
        "#,
        Uuid::new_v4(),
        token.org_id,
        payload.agent_id,
        payload.hardware_fingerprint,
        payload.hostname,
        Utc::now(),
        Utc::now(),
        Utc::now(),
        token.token_id,
        payload.os_version,
        Utc::now()
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Enrollment: Failed to insert/update agent: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let outcome = if insert_result.inserted { "enrolled" } else { "reinstall" };

    // Log attempt success
    sqlx::query!(
        r#"
        INSERT INTO enrollment_attempts 
        (token_id, machine_fingerprint, hostname, os_type, outcome)
        VALUES ($1, $2, $3, $4, $5)
        "#,
        token.token_id,
        payload.hardware_fingerprint,
        payload.hostname,
        payload.os_version,
        outcome
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Enrollment: Failed to log attempt: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Audit Log for Enrollment
    log_audit(
        &mut tx,
        ActorType::System, // Enrollment is a SYSTEM action authorized by a token
        None, 
        Some(token.org_id),
        "AGENT_ENROLLED",
        "AGENT",
        Some(payload.agent_id.clone()),
        serde_json::json!({ 
            "hostname": payload.hostname,
            "os_version": payload.os_version,
            "token_id": token.token_id,
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

    tracing::info!("Agent enrolled: {} for Organization: {}", payload.agent_id, token.org_name);

    Ok(Json(serde_json::json!({
        "status": "success",
        "agent_id": payload.agent_id,
        "organization_id": token.org_id,
        "organization_name": token.org_name
    })))
}

pub async fn register_agent(
    State(state): State<AppState>,
    Json(agent): Json<CreateAgent>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Legacy support or redirect to enroll
    enroll_agent(State(state), Json(agent)).await
}

/// `storage/agent/latest.json` — the published agent release the fleet should converge to.
/// `version` is the **agent semver** (matches CARGO_PKG_VERSION), not the MSI ProductVersion.
#[derive(serde::Deserialize)]
struct AgentManifest {
    version: String,
    sha256: String,
    #[serde(default)]
    filename: Option<String>,
}

fn read_agent_manifest(dir: &std::path::Path) -> Option<AgentManifest> {
    let data = std::fs::read(dir.join("latest.json")).ok()?;
    serde_json::from_slice(&data).ok()
}

pub async fn heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(heartbeat): Json<crate::db::models::Heartbeat>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let org_id = headers
        .get("X-Organization-Id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|e| {
        tracing::error!("Heartbeat: Failed to begin RLS tx for org {}: {}", org_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Persist the agent's running CARGO_PKG_VERSION so we can verify rollout from psql
    // ("SELECT agent_version, count(*) FROM agents GROUP BY agent_version") without needing
    // to walk up to an endpoint.
    let result = sqlx::query!(
        r#"
        UPDATE agents
        SET last_seen = $1, updated_at = $1, hostname = COALESCE($2, hostname), agent_version = $5
        WHERE agent_id = $3 AND organization_id = $4
        "#,
        Utc::now(),
        heartbeat.hostname,
        &heartbeat.agent_id,
        org_id,
        &heartbeat.version,
    )
    .execute(&mut *tx)
    .await;

    let res = match result {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to update heartbeat: {}", e);
            return Err(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };

    if res.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Heartbeat: Failed to commit tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // Advertise the latest published agent. The agent compares this version against its own
    // and self-updates (downloads the MSI from /api/v1/agent/download) if it's behind.
    let mut body = serde_json::json!({"status": "success"});
    if let Some(m) = read_agent_manifest(&state.agent_dist_dir) {
        body["update"] = serde_json::json!({
            "version": m.version,
            "sha256": m.sha256,
            "url": "/api/v1/agent/download",
        });
    }

    Ok(Json(body))
}

/// Serve the published agent installer (MSI) for auto-update. Unauthenticated by design —
/// same trust model as enroll/heartbeat (gated by the internal-network firewall). Integrity
/// is checked agent-side via the sha256 from the heartbeat manifest.
/// SECURITY: over plain HTTP this is effectively SYSTEM-level remote code delivery; the real
/// hardening is TLS + an Authenticode-signed MSI (tracked separately).
pub async fn download_agent_installer(
    State(state): State<AppState>,
) -> Result<Response<Body>, StatusCode> {
    let filename = read_agent_manifest(&state.agent_dist_dir)
        .and_then(|m| m.filename)
        .unwrap_or_else(|| "RAVAgent.msi".to_string());
    let data = std::fs::read(state.agent_dist_dir.join(&filename))
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", filename))
        .body(Body::from(data))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?)
}

pub async fn list_agents(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
) -> Result<Json<Vec<serde_json::Value>>, StatusCode> {
    let mut tx = if claims.role == "super_admin" {
        if let Some(org_id) = headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
        {
            state.db.begin_rls_tx(org_id).await
        } else {
            state.db.begin_bypass_tx().await
        }
    } else {
        let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
        state.db.begin_rls_tx(org_id).await
    }
    .map_err(|e| {
        tracing::error!("Failed to begin RLS transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let agents = sqlx::query(
        r#"
        SELECT a.id, a.organization_id, a.agent_id, a.hardware_fingerprint, a.hostname,
               a.display_name, a.last_seen, a.created_at, a.updated_at,
               a.enrollment_token_id, t.label AS token_label,
               a.watchdog_last_seen, a.watchdog_service_state, a.watchdog_binary_present,
               a.watchdog_version,
               (
                   SELECT state FROM agent_lifecycle_events l
                   WHERE l.agent_id = a.agent_id AND l.organization_id = a.organization_id
                   ORDER BY l.received_at DESC LIMIT 1
               ) AS last_lifecycle_state,
               (
                   SELECT received_at FROM agent_lifecycle_events l
                   WHERE l.agent_id = a.agent_id AND l.organization_id = a.organization_id
                   ORDER BY l.received_at DESC LIMIT 1
               ) AS last_lifecycle_at
        FROM agents a
        LEFT JOIN enrollment_tokens t ON a.enrollment_token_id = t.token_id
        WHERE a.deleted_at IS NULL
        ORDER BY a.last_seen DESC
        "#,
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to query agents: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit RLS transaction: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let now = Utc::now();
    let result: Vec<serde_json::Value> = agents
        .into_iter()
        .map(|row| {
            let last_seen = row.get::<chrono::DateTime<Utc>, _>("last_seen");
            serde_json::json!({
                "id": row.get::<Uuid, _>("id"),
                "organization_id": row.get::<Uuid, _>("organization_id"),
                "agent_id": row.get::<String, _>("agent_id"),
                "hardware_fingerprint": row.get::<String, _>("hardware_fingerprint"),
                "hostname": row.get::<Option<String>, _>("hostname"),
                "display_name": row.get::<Option<String>, _>("display_name"),
                "last_seen": last_seen,
                "last_seen_ms": last_seen.timestamp_millis(),
                "server_time_ms": now.timestamp_millis(), // Add this for clock-sync
                "created_at": row.get::<chrono::DateTime<Utc>, _>("created_at"),
                "updated_at": row.get::<chrono::DateTime<Utc>, _>("updated_at"),
                "enrollment_token_id": row.get::<Option<Uuid>, _>("enrollment_token_id"),
                "campaign": row.get::<Option<String>, _>("token_label"),
                "watchdog_last_seen": row.get::<Option<chrono::DateTime<Utc>>, _>("watchdog_last_seen"),
                "watchdog_service_state": row.get::<Option<String>, _>("watchdog_service_state"),
                "watchdog_binary_present": row.get::<Option<bool>, _>("watchdog_binary_present"),
                "watchdog_version": row.get::<Option<String>, _>("watchdog_version"),
                "last_lifecycle_state": row.get::<Option<String>, _>("last_lifecycle_state"),
                "last_lifecycle_at": row.get::<Option<chrono::DateTime<Utc>>, _>("last_lifecycle_at"),
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

    // Look up the agent's org in BYPASS mode (agents has FORCE RLS).
    let mut lookup_tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Upload: Failed to begin bypass tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    let org_id = sqlx::query!(
        "SELECT organization_id FROM agents WHERE agent_id = $1 AND deleted_at IS NULL",
        agent_id
    )
    .fetch_optional(&mut *lookup_tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .map(|r| r.organization_id)
    .ok_or(StatusCode::UNAUTHORIZED)?;
    lookup_tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let data = file_data.unwrap();
    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|e| {
        tracing::error!("Upload: Failed to begin RLS tx for org {}: {}", org_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    // Treat duplicate file_id as success — the agent retries the same id from its
    // offline cache when uploads are interrupted, and the file content is already
    // recorded. Without this the agent loops forever re-uploading the same blob.
    sqlx::query!(
        "INSERT INTO files (file_id, organization_id, agent_id, file_name, file_size) \
         VALUES ($1, $2, $3, $4, $5) \
         ON CONFLICT (file_id) DO NOTHING",
        file_id, org_id, agent_id, file_name, data.len() as i64
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to record file in DB: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    tx.commit().await.map_err(|e| {
        tracing::error!("Upload: Failed to commit file insert tx: {}", e);
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
    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    // The files table has FORCE RLS. The lookup must run inside an org-scoped
    // transaction so app.current_org_id is set; on the raw pool the policy is
    // fail-closed and the row is invisible, which 404s every screenshot download.
    let mut tx = state.db.begin_rls_tx(target_org_id).await.map_err(|e| {
        tracing::error!("Download: Failed to begin RLS tx for org {}: {}", target_org_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let _file_record = sqlx::query!(
        "SELECT file_name FROM files WHERE file_id = $1 AND organization_id = $2",
        file_id, target_org_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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
    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    // Wrap the wipe + audit log in a single tx so a failed audit rolls back the wipe.
    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Wipe: Failed to begin tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let result = sqlx::query!(
        "UPDATE events SET deleted_at = $1 WHERE agent_id = $2 AND organization_id = $3 AND deleted_at IS NULL",
        Utc::now(), &agent_id, target_org_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let deleted_count = result.rows_affected();

    let (ip, ua) = extract_request_meta(&headers);
    log_audit(
        &mut tx,
        actor_type_from_role(&claims.role),
        Some(claims.sub),
        Some(target_org_id),
        "AGENT_EVENTS_WIPED",
        "AGENT",
        Some(agent_id.clone()),
        serde_json::json!({
            "agent_id": agent_id,
            "deleted_count": deleted_count,
        }),
        ip,
        ua,
    ).await.map_err(|e| {
        tracing::error!("Wipe: Failed to audit log: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({
        "status": "success",
        "deleted_count": deleted_count
    })))
}

/// Set or clear the human-readable label shown for an agent in dashboard lists. Does NOT
/// touch agent_id or hostname — those remain the immutable identity used by every query,
/// audit log, and foreign key. Pass `display_name: null` to clear back to "use hostname".
#[derive(Deserialize)]
pub struct UpdateDisplayNamePayload {
    pub display_name: Option<String>,
}

pub async fn update_agent_display_name(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
    Json(payload): Json<UpdateDisplayNamePayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    // Renaming a device is an admin action — org users shouldn't be able to relabel devices.
    if claims.role != "org_admin" && claims.role != "super_admin" {
        return Err(StatusCode::FORBIDDEN);
    }

    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    // Normalize: trim whitespace; treat empty as "clear it" (NULL).
    let cleaned: Option<String> = payload
        .display_name
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    // Hard cap so the UI doesn't get a 4 KB "name."
    if let Some(ref name) = cleaned {
        if name.chars().count() > 100 {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let result = sqlx::query!(
        "UPDATE agents SET display_name = $1, updated_at = NOW() WHERE agent_id = $2 AND organization_id = $3 AND deleted_at IS NULL",
        cleaned.as_deref(),
        &agent_id,
        target_org_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        return Err(StatusCode::NOT_FOUND);
    }

    let (ip, ua) = extract_request_meta(&headers);
    log_audit(
        &mut tx,
        actor_type_from_role(&claims.role),
        Some(claims.sub),
        Some(target_org_id),
        "AGENT_RENAMED",
        "AGENT",
        Some(agent_id.clone()),
        serde_json::json!({
            "agent_id": agent_id,
            "display_name": cleaned,
        }),
        ip,
        ua,
    ).await.map_err(|e| {
        tracing::error!("Rename: Failed to audit log: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(serde_json::json!({
        "status": "success",
        "agent_id": agent_id,
        "display_name": cleaned,
    })))
}

pub async fn delete_agent(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query!(
        "UPDATE agents SET deleted_at = $1 WHERE agent_id = $2 AND organization_id = $3 AND deleted_at IS NULL",
        Utc::now(), &agent_id, target_org_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (ip, ua) = extract_request_meta(&headers);
    log_audit(
        &mut tx,
        actor_type_from_role(&claims.role),
        Some(claims.sub),
        Some(target_org_id),
        "AGENT_DELETED",
        "AGENT",
        Some(agent_id.clone()),
        serde_json::json!({ "agent_id": agent_id }),
        ip,
        ua,
    ).await.map_err(|e| {
        tracing::error!("DeleteAgent: Failed to audit log: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

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

    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let result = sqlx::query!(
        "UPDATE events SET deleted_at = NULL WHERE agent_id = $1 AND organization_id = $2 AND deleted_at IS NOT NULL",
        &agent_id, target_org_id
    )
    .execute(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let restored_count = result.rows_affected();
    let (ip, ua) = extract_request_meta(&headers);
    log_audit(
        &mut tx,
        actor_type_from_role(&claims.role),
        Some(claims.sub),
        Some(target_org_id),
        "AGENT_EVENTS_RESTORED",
        "AGENT",
        Some(agent_id.clone()),
        serde_json::json!({
            "agent_id": agent_id,
            "restored_count": restored_count,
        }),
        ip,
        ua,
    ).await.map_err(|e| {
        tracing::error!("Restore: Failed to audit log: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    
    Ok(Json(serde_json::json!({
        "status": "success",
        "restored_count": result.rows_affected()
    })))
}
#[derive(Debug, Deserialize)]
pub struct DownloadQuery {
    pub password: Option<String>,
}

pub async fn list_agent_archives(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<Vec<crate::db::models::Archive>>, StatusCode> {
    let target_org_id = if claims.role == "super_admin" {
        headers.get("X-Organization-Id").and_then(|h| h.to_str().ok()).and_then(|s| Uuid::parse_str(s).ok()).ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    let archives = state.archive_service.list_archives(&agent_id, target_org_id).await
        .map_err(|e| {
            tracing::error!("Failed to list archives: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(archives))
}

pub async fn download_archive(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(archive_id): Path<Uuid>,
    // Password comes in the POST body (never the URL) so it isn't leaked into
    // browser history or proxy/access logs.
    Json(params): Json<DownloadQuery>,
) -> Result<Response<Body>, StatusCode> {
    // 1. Password Verification (Security layer). users has FORCE RLS, so look up the
    // caller's own row in a BYPASS tx (self-auth of an already-JWT-authenticated user).
    let password = params.password.ok_or(StatusCode::UNAUTHORIZED)?;
    let user_row = {
        let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let row = sqlx::query!("SELECT password_hash FROM users WHERE id = $1", claims.sub)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
            .ok_or(StatusCode::UNAUTHORIZED)?;
        tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        row
    };

    if !bcrypt::verify(&password, &user_row.password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let target_org_id = if claims.role == "super_admin" {
        headers.get("X-Organization-Id").and_then(|h| h.to_str().ok()).and_then(|s| Uuid::parse_str(s).ok()).ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    // archives has FORCE RLS — verify ownership and burn within an org-scoped tx.
    let mut tx = state.db.begin_rls_tx(target_org_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let archive = sqlx::query!(
        "SELECT filename FROM archives WHERE id = $1 AND organization_id = $2",
        archive_id, target_org_id
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::NOT_FOUND)?;

    let archive_path = state.archive_service.storage_dir().join(&archive.filename);
    let data = match std::fs::read(&archive_path) {
        Ok(d) => d,
        Err(_) => {
            // File is gone (e.g. already burned by a prior download). Remove the orphaned
            // row so the stale card disappears from the vault, then report not-found.
            let _ = sqlx::query!("DELETE FROM archives WHERE id = $1", archive_id)
                .execute(&mut *tx)
                .await;
            let _ = tx.commit().await;
            return Err(StatusCode::NOT_FOUND);
        }
    };

    // 2. ATOMIC DELETE (Burn after download)
    let _ = std::fs::remove_file(&archive_path);
    let _ = sqlx::query!("DELETE FROM archives WHERE id = $1", archive_id).execute(&mut *tx).await;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/zip")
        .header(header::CONTENT_DISPOSITION, format!("attachment; filename=\"{}\"", archive.filename))
        .body(Body::from(data))
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?)
}

pub async fn trigger_agent_archive(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
    Path(agent_id): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let target_org_id = if claims.role == "super_admin" {
        headers.get("X-Organization-Id").and_then(|h| h.to_str().ok()).and_then(|s| Uuid::parse_str(s).ok()).ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    // MANUAL TRIGGER always includes recent events for immediate validation
    let archive = state.archive_service.archive_agent_telemetry(&agent_id, target_org_id, true).await
        .map_err(|e| {
            tracing::error!("Manual archival failed for {}: {}", agent_id, e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if let Some(arch) = archive {
        let _ = state.notification_service.notify_archive_ready(target_org_id, &agent_id, &state.encryption_service).await;

        // Audit log — best-effort; the archive already exists, so we never fail the user's
        // request on a logging error, but we DO loudly log it server-side.
        let (ip, ua) = extract_request_meta(&headers);
        let log_result: Result<(), sqlx::Error> = async {
            let mut tx = state.db.begin_bypass_tx().await?;
            log_audit(
                &mut tx,
                actor_type_from_role(&claims.role),
                Some(claims.sub),
                Some(target_org_id),
                "ARCHIVE_TRIGGERED",
                "AGENT",
                Some(agent_id.clone()),
                serde_json::json!({
                    "agent_id": agent_id,
                    "archive_id": arch.id,
                    "filename": arch.filename,
                    "events_archived": arch.event_count,
                }),
                ip,
                ua,
            ).await?;
            tx.commit().await?;
            Ok(())
        }.await;
        if let Err(e) = log_result {
            tracing::error!("ArchiveTrigger: audit log failed for {}: {}", agent_id, e);
        }

        Ok(Json(serde_json::json!({
            "status": "success",
            "archive_id": arch.id,
            "filename": arch.filename,
            "events_archived": arch.event_count
        })))
    } else {
        Ok(Json(serde_json::json!({
            "status": "skipped",
            "message": "No telemetry found for this agent."
        })))
    }
}

pub async fn trigger_org_archive(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let target_org_id = if claims.role == "super_admin" {
        headers.get("X-Organization-Id").and_then(|h| h.to_str().ok()).and_then(|s| Uuid::parse_str(s).ok()).ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    // 1. Fetch all agents for this org
    let agents = sqlx::query!("SELECT agent_id FROM agents WHERE organization_id = $1 AND deleted_at IS NULL", target_org_id)
        .fetch_all(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut results = Vec::new();

    // 2. Archive each agent
    for agent in agents {
        if let Ok(Some(arch)) = state.archive_service.archive_agent_telemetry(&agent.agent_id, target_org_id, true).await {
            let _ = state.notification_service.notify_archive_ready(target_org_id, &agent.agent_id, &state.encryption_service).await;
            results.push(serde_json::json!({
                "agent_id": agent.agent_id,
                "archive_id": arch.id,
                "filename": arch.filename,
                "events_archived": arch.event_count
            }));
        }
    }

    // Audit log — one row for the org-wide trigger summarising the batch.
    let (ip, ua) = extract_request_meta(&headers);
    let archives_generated = results.len();
    let log_result: Result<(), sqlx::Error> = async {
        let mut tx = state.db.begin_bypass_tx().await?;
        log_audit(
            &mut tx,
            actor_type_from_role(&claims.role),
            Some(claims.sub),
            Some(target_org_id),
            "ORG_ARCHIVE_TRIGGERED",
            "ORGANIZATION",
            Some(target_org_id.to_string()),
            serde_json::json!({
                "organization_id": target_org_id,
                "archives_generated": archives_generated,
                "details": results,
            }),
            ip,
            ua,
        ).await?;
        tx.commit().await?;
        Ok(())
    }.await;
    if let Err(e) = log_result {
        tracing::error!("OrgArchiveTrigger: audit log failed for org {}: {}", target_org_id, e);
    }

    Ok(Json(serde_json::json!({
        "status": "success",
        "archives_generated": archives_generated,
        "details": results
    })))
}

pub async fn get_org_settings(
    State(state): State<AppState>,
    claims: Claims,
) -> Result<Json<crate::db::models::OrganizationSettings>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    
    let settings = sqlx::query_as!(
        crate::db::models::OrganizationSettings,
        "SELECT * FROM organization_settings WHERE organization_id = $1",
        org_id
    )
    .fetch_optional(state.db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    match settings {
        Some(mut s) => {
            // Mask the encrypted password for the frontend
            s.smtp_password_encrypted = s.smtp_password_encrypted.map(|_| "********".to_string());
            Ok(Json(s))
        },
        None => {
            // Return empty settings
            Ok(Json(crate::db::models::OrganizationSettings {
                id: Uuid::nil(),
                organization_id: org_id,
                smtp_host: None,
                smtp_port: None,
                smtp_username: None,
                smtp_password_encrypted: None,
                smtp_from_email: None,
                smtp_enabled: Some(false),
                updated_at: Utc::now(),
            }))
        }
    }
}

pub async fn update_org_settings(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<crate::db::models::UpdateOrganizationSettings>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;

    // 1. Mandatory Password Verification (Security layer)
    let user_row = sqlx::query!("SELECT password_hash FROM users WHERE id = $1", claims.sub)
        .fetch_optional(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if !bcrypt::verify(&payload.verify_password, &user_row.password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        return Err(StatusCode::UNAUTHORIZED);
    }

    // 2. Encrypt SMTP Password if provided
    let enc_smtp_pass = if let Some(raw_pass) = payload.smtp_password {
        Some(state.encryption_service.encrypt(&raw_pass).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?)
    } else {
        None
    };

    // 3. UPSERT Settings
    sqlx::query!(
        r#"
        INSERT INTO organization_settings (organization_id, smtp_host, smtp_port, smtp_username, smtp_password_encrypted, smtp_from_email, smtp_enabled, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (organization_id) DO UPDATE
        SET smtp_host = COALESCE($2, organization_settings.smtp_host),
            smtp_port = COALESCE($3, organization_settings.smtp_port),
            smtp_username = COALESCE($4, organization_settings.smtp_username),
            smtp_password_encrypted = COALESCE($5, organization_settings.smtp_password_encrypted),
            smtp_from_email = COALESCE($6, organization_settings.smtp_from_email),
            smtp_enabled = COALESCE($7, organization_settings.smtp_enabled),
            updated_at = NOW()
        "#,
        org_id,
        payload.smtp_host,
        payload.smtp_port,
        payload.smtp_username,
        enc_smtp_pass,
        payload.smtp_from_email,
        payload.smtp_enabled
    )
    .execute(state.db.pool())
    .await
    .map_err(|e| {
        tracing::error!("Failed to update org settings: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(serde_json::json!({"status": "success"})))
}

pub async fn test_org_settings(
    State(state): State<AppState>,
    claims: Claims,
    Json(payload): Json<TestSmtpPayload>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let _org_id = claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?;
    
    // 1. Get user email to send the test to
    let user_email = sqlx::query!("SELECT email FROM users WHERE id = $1", claims.sub)
        .fetch_one(state.db.pool())
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .email;

    // 2. Delegate to NotificationService
    state.notification_service.test_smtp_configuration(
        &user_email,
        &payload.smtp_host,
        payload.smtp_port,
        payload.smtp_username.as_deref(),
        payload.smtp_password.as_deref(),
        &payload.smtp_from_email,
    ).await.map_err(|e| {
        tracing::error!("SMTP test failed: {}", e);
        StatusCode::BAD_REQUEST
    })?;

    Ok(Json(serde_json::json!({"status": "success", "message": "Test email dispatched successfully."})))
}

pub async fn get_all_archives(
    State(state): State<AppState>,
    claims: Claims,
    headers: HeaderMap,
) -> Result<Json<Vec<crate::db::models::Archive>>, StatusCode> {
    let target_org_id = if claims.role == "super_admin" {
        headers
            .get("X-Organization-Id")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::BAD_REQUEST)?
    } else {
        claims.org_id.ok_or(StatusCode::UNAUTHORIZED)?
    };

    // archives has FORCE RLS — scope the read to the org via an RLS transaction.
    let mut tx = state.db.begin_rls_tx(target_org_id).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let archives = sqlx::query_as::<_, crate::db::models::Archive>(
        "SELECT * FROM archives WHERE organization_id = $1 ORDER BY created_at DESC"
    )
    .bind(target_org_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch all archives: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;
    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(archives))
}

// ===========================================================================
// AGENT HEALTH SIGNALS: watchdog + lifecycle
// ===========================================================================
//
// These let the backend tell apart "stopped", "killed", "removed" and
// "offline (unknown)". The main agent's heartbeat alone can't — it just goes
// silent in all of those cases. The two extra signals close that gap:
//
//   * Watchdog: posted by a separate Windows Scheduled Task on the endpoint,
//     so it keeps reporting even when the main service is dead/removed.
//   * Lifecycle: posted by the main agent on graceful start/stop; a recent
//     "stopping" before silence proves the stop was intentional.

pub async fn report_watchdog(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(report): Json<crate::db::models::WatchdogReport>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let org_id = headers
        .get("X-Organization-Id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|e| {
        tracing::error!("Watchdog: Failed to begin RLS tx for org {}: {}", org_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let result = sqlx::query!(
        r#"
        UPDATE agents
        SET watchdog_last_seen      = NOW(),
            watchdog_service_state  = $1,
            watchdog_binary_present = $2,
            watchdog_version        = $3,
            hostname                = COALESCE($4, hostname)
        WHERE agent_id = $5 AND organization_id = $6
        "#,
        report.service_state,
        report.binary_present,
        report.watchdog_version,
        report.hostname,
        &report.agent_id,
        org_id,
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update watchdog snapshot: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if result.rows_affected() == 0 {
        // Agent isn't enrolled in this org. Don't error noisily — the watchdog
        // is fire-and-forget; just tell it nothing was recorded.
        return Err(StatusCode::NOT_FOUND);
    }

    tx.commit().await.map_err(|e| {
        tracing::error!("Watchdog: commit failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(serde_json::json!({"status": "success"})))
}

pub async fn report_lifecycle(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(event): Json<crate::db::models::LifecycleEvent>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let org_id = headers
        .get("X-Organization-Id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Validate state — anything outside the known vocabulary gets rejected so
    // the table doesn't accumulate junk.
    let state_str = event.state.as_str();
    if !matches!(state_str, "started" | "stopping" | "uninstalling") {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut tx = state.db.begin_rls_tx(org_id).await.map_err(|e| {
        tracing::error!("Lifecycle: Failed to begin RLS tx for org {}: {}", org_id, e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    sqlx::query!(
        r#"
        INSERT INTO agent_lifecycle_events (agent_id, organization_id, state, reason, reported_at)
        VALUES ($1, $2, $3, $4, NOW())
        "#,
        &event.agent_id,
        org_id,
        state_str,
        event.reason,
    )
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to insert lifecycle event: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Lifecycle: commit failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(serde_json::json!({"status": "success"})))
}
