use anyhow::Result;
use axum::{
    http::StatusCode,
    routing::{get, post, delete, put, patch},
    Router,
    extract::FromRef,
};
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;
use tracing::info;

pub mod api;
pub mod db;
pub mod services;
mod config;

use api::handlers;
use config::AppConfig;
use db::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub config: Arc<AppConfig>,
    pub archive_service: Arc<crate::services::archive::ArchiveService>,
    pub notification_service: Arc<crate::services::notifications::NotificationService>,
    pub encryption_service: Arc<crate::services::crypto::EncryptionService>,
    pub file_storage_dir: std::path::PathBuf,
    /// Where the published agent installer + latest.json manifest live (for auto-update).
    pub agent_dist_dir: std::path::PathBuf,
    pub server_start_time: chrono::DateTime<chrono::Utc>,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Load .env file
    dotenv::dotenv().ok();

    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rav_backend=info".into()),
        )
        .init();

    info!("RAV Backend starting...");

    // Load configuration
    let config = Arc::new(AppConfig::load()?);
    info!("Configuration loaded");
    info!("CORS Allowed Origins: {}", config.cors_allowed_origins);

    // Initialize database
    let db = Arc::new(Database::new(&config.database_url).await?);
    info!("Database initialized");

    // Run migrations
    db.run_migrations().await?;
    info!("Database migrations completed");

    // Create file storage directory
    let file_storage_dir = std::path::PathBuf::from("storage/files");
    std::fs::create_dir_all(&file_storage_dir)?;
    info!("File storage directory: {}", file_storage_dir.display());

    // Agent distribution directory (auto-update): holds RAVAgent.msi + latest.json.
    let agent_dist_dir = std::path::PathBuf::from("storage/agent");
    std::fs::create_dir_all(&agent_dist_dir)?;
    info!("Agent distribution directory: {}", agent_dist_dir.display());

    // Initialize Archive System
    let archive_storage = std::path::PathBuf::from("storage/archives");
    let archive_service = Arc::new(crate::services::archive::ArchiveService::new(
        db.pool().clone(),
        archive_storage,
        file_storage_dir.clone(),
        config.report_max_screenshots,
    ));
    info!("Archive storage: {}", archive_service.storage_dir().display());
    
    // Initialize OCR / content-scanning service. Wraps the local tesseract
    // binary and runs the pending-files sweep spawned below.
    let ocr_service = Arc::new(crate::services::ocr::OcrService::new(
        db.pool().clone(),
        file_storage_dir.clone(),
    ));
    if ocr_service.tesseract_available() {
        info!("OCR: tesseract binary detected; sensitive-text scanning enabled");
    } else {
        tracing::warn!("OCR: tesseract not found on PATH — install `tesseract-ocr` to enable sensitive-text scanning");
    }

    // Initialize Notification System
    let notification_service = Arc::new(crate::services::notifications::NotificationService::new(
        config.clone(),
        db.pool().clone()
    ));

    // Initialize Encryption System
    let encryption_service = Arc::new(crate::services::crypto::EncryptionService::new(&config.jwt_secret));

    let app_state = AppState {
        db: db.clone(),
        config: config.clone(),
        archive_service: archive_service.clone(),
        notification_service: notification_service.clone(),
        encryption_service: encryption_service.clone(),
        file_storage_dir: file_storage_dir.clone(),
        agent_dist_dir: agent_dist_dir.clone(),
        server_start_time: chrono::Utc::now(),
    };

    // Spawn Background OCR Sweep — every OCR_INTERVAL_SECS (default 15s),
    // claim up to OCR_BATCH_SIZE pending files, OCR each, match keywords,
    // write flags back. Sleep is at the END of the loop so the very first
    // tick runs immediately after boot (used to burn a full interval doing
    // nothing before the first sweep). Cheap when idle (single SQL query
    // returns zero rows); heavy per file when there's a backlog. Bounded
    // by batch_size + interval so we can't peg the CPU.
    let ocr_bg = ocr_service.clone();
    let ocr_interval_secs: u64 = std::env::var("OCR_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(15);
    info!("OCR: sweep interval = {}s", ocr_interval_secs);
    tokio::spawn(async move {
        loop {
            let batch = match ocr_bg.claim_batch().await {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!("OCR: claim_batch failed: {}", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(ocr_interval_secs)).await;
                    continue;
                }
            };
            if !batch.is_empty() {
                info!("OCR: processing {} pending file(s)", batch.len());
                for file in batch {
                    if let Err(e) = ocr_bg.process_one(file).await {
                        tracing::error!("OCR: process_one failed: {}", e);
                    }
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(ocr_interval_secs)).await;
        }
    });

    // Spawn Background Archiver Job.
    //
    // Cadence: sweep every 30 s (was 12 h), per-agent gate at 5 days. The
    // 30 s tick is cheap — the eligibility query is one row-set-returning
    // SELECT and typically returns 0 rows. Each agent still archives at
    // MOST once per 5 days because agents.last_archived_at gates each
    // pass. Net effect: an agent that just crossed the 5-day boundary
    // gets archived within ~30 s instead of waiting up to a full 12 h,
    // AND no agent ever gets a second archive inside the same 5-day
    // window from the auto path (manual triggers bypass the gate — see
    // handlers::trigger_agent_archive).
    //
    // Archive window: each archive is a non-destructive snapshot of the LAST 5 days
    // of events (model b). Events are purged separately by cleanup_old_events.
    //
    // Vault retention (2 days) + file retention (bumped to match archive
    // cadence, see cleanup_old_files call below) also run on the same
    // 30 s tick but each has its own idempotent skip.
    const SWEEP_INTERVAL_SECS: u64 = 30;
    const ARCHIVE_CUTOFF_DAYS: i64 = 5;
    const PER_AGENT_ARCHIVE_MIN_INTERVAL_DAYS: i64 = 5;
    // File retention MUST exceed the archive cutoff, otherwise the file
    // cleanup sweep can delete a screenshot BEFORE the archive service
    // has bundled it into the ZIP — the "no screenshots in the archive"
    // bug operators reported. Keep files 2 days past the archive cutoff
    // so an agent has a wide safety window even if its archive is
    // slightly delayed.
    const FILE_RETENTION_DAYS: i64 = ARCHIVE_CUTOFF_DAYS + 2;
    // Events retention (model b): archiving is now a non-destructive COPY of the last
    // ARCHIVE_CUTOFF_DAYS, so a separate purge keeps the events table bounded. Same
    // "+2 days past the archive window" margin as files, so an event is always
    // snapshotted before it's ever purged, even if a sweep is slightly delayed.
    const EVENT_RETENTION_DAYS: i64 = ARCHIVE_CUTOFF_DAYS + 2;
    let archive_bg = archive_service.clone();
    let notify_bg = notification_service.clone();
    let encryption_bg = encryption_service.clone();
    let db_bg = db.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(SWEEP_INTERVAL_SECS)).await;

            // Cross-org scan: which agents have RECENT events (within the archive
            // window) AND haven't been snapshotted in the last
            // PER_AGENT_ARCHIVE_MIN_INTERVAL_DAYS. events + agents both have FORCE RLS,
            // so this MUST run in a BYPASS transaction or it silently returns 0 rows.
            let result = async {
                let mut tx = db_bg.begin_bypass_tx().await?;
                // Cap this probe so a pathological scan can never hold a pooled
                // connection open for the full server timeout and starve the
                // rest of the backend (the "pool timed out" degradation).
                sqlx::query("SET LOCAL statement_timeout = '20s'")
                    .execute(&mut *tx)
                    .await?;
                // Agent-FIRST eligibility. Walk the small agents table and
                // probe each with a short-circuiting EXISTS, instead of a
                // SELECT DISTINCT over the entire (huge, never-purged) events
                // table — that scan was taking 30 s+ and timing out. LIMIT
                // keeps each 30 s tick's workload bounded so a large backlog
                // is worked off incrementally rather than in one giant run.
                let rows = sqlx::query(
                    r#"
                    SELECT a.agent_id, a.organization_id
                    FROM agents a
                    WHERE a.deleted_at IS NULL
                      AND (
                          a.last_archived_at IS NULL
                          OR a.last_archived_at < NOW() - ($2 || ' days')::interval
                      )
                      AND EXISTS (
                          SELECT 1 FROM events e
                          WHERE e.agent_id = a.agent_id
                            AND e.organization_id = a.organization_id
                            AND e.created_at >= NOW() - ($1 || ' days')::interval
                      )
                    LIMIT 25
                    "#,
                )
                .bind(ARCHIVE_CUTOFF_DAYS.to_string())
                .bind(PER_AGENT_ARCHIVE_MIN_INTERVAL_DAYS.to_string())
                .fetch_all(&mut *tx)
                .await?;
                tx.commit().await?;
                Ok::<_, sqlx::Error>(rows)
            }
            .await;

            if let Ok(targets) = result {
                if !targets.is_empty() {
                    info!("Archive sweep: {} agent(s) eligible for archiving.", targets.len());
                }
                for row in targets {
                    use sqlx::Row;
                    let agent_id: String = row.get("agent_id");
                    let org_id: uuid::Uuid = row.get("organization_id");
                    match archive_bg.archive_agent_telemetry(&agent_id, org_id, false).await {
                        Ok(Some(_arch)) => {
                            let _ = notify_bg
                                .notify_archive_ready(org_id, &agent_id, &encryption_bg)
                                .await;
                        }
                        Ok(None) => {}
                        Err(e) => {
                            tracing::error!("Archive sweep: agent {} org {} failed: {}", agent_id, org_id, e);
                        }
                    }
                }
            }

            // 2-day vault retention sweep — download window for admins.
            if let Err(e) = archive_bg.cleanup_old_archives(2).await {
                tracing::error!("Archive cleanup failed: {}", e);
            }

            // File / screenshot retention. Bounded ABOVE the archive cutoff
            // (see FILE_RETENTION_DAYS comment) so the cleanup sweep never
            // races the archive sweep and deletes evidence that hasn't been
            // bundled yet.
            if let Err(e) = archive_bg.cleanup_old_files(FILE_RETENTION_DAYS as i64).await {
                tracing::error!("File cleanup failed: {}", e);
            }

            // Events retention (model b). Archiving no longer deletes events, so this
            // dedicated purge is what bounds the events table. EVENT_RETENTION_DAYS is
            // kept a safe margin above the archive window so nothing is purged before
            // it has been snapshotted into an archive.
            if let Err(e) = archive_bg.cleanup_old_events(EVENT_RETENTION_DAYS as i64).await {
                tracing::error!("Event cleanup failed: {}", e);
            }
        }
    });
    
    // Build application
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/time", get(server_time))
        .route("/api/v1/auth/login", post(api::auth::login))
        .route("/api/v1/auth/register", post(api::auth::register))
        .route("/api/v1/auth/me", get(api::auth::me))
        .route("/api/v1/auth/change-password", post(api::auth::change_password))
        .route("/api/v1/auth/logout", post(api::auth::logout))
        .route("/api/v1/admin/organizations", get(api::admin::list_organizations))
        .route("/api/v1/admin/organizations", post(api::admin::create_organization))
        .route("/api/v1/admin/organizations/:id/status", patch(api::admin::update_organization_status))
        .route("/api/v1/admin/organizations/:id", patch(api::admin::update_organization))
        .route("/api/v1/admin/stats", get(api::admin::get_platform_stats))
        .route("/api/v1/admin/health", get(api::admin::get_system_health))
        .route("/api/v1/admin/organizations/:id", delete(api::admin::delete_organization))
        .route("/api/v1/admin/organizations/:id/restore", post(api::admin::restore_organization_data))
        .route("/api/v1/admin/organizations/:id/admins", get(api::admin::list_org_admins))
        .route("/api/v1/admin/organizations/:org_id/admins/:user_id/reset-password", post(api::admin::reset_org_admin_password))
        .route("/api/v1/admin/audits", get(api::admin::list_audit_logs))
        .route("/api/v1/org/me", get(api::org::get_current_org))
        .route("/api/v1/org/stats", get(api::org::get_org_stats))
        .route("/api/v1/org/settings", get(handlers::get_org_settings))
        .route("/api/v1/org/settings", patch(handlers::update_org_settings))
        .route("/api/v1/org/settings/verify", post(handlers::verify_identity))
        .route("/api/v1/org/settings/test", post(handlers::test_org_settings))
        .route("/api/v1/org/audits", get(api::org::list_org_audit_logs))
        .route("/api/v1/org/enrollment-tokens", get(api::org::list_enrollment_tokens).post(api::org::create_enrollment_token))
        .route("/api/v1/org/enrollment-tokens/:token_id", delete(api::org::revoke_enrollment_token).patch(api::org::update_enrollment_token))
        .route("/api/v1/org/keywords", get(api::org::list_keywords).post(api::org::create_keyword))
        .route("/api/v1/org/keywords/:id", delete(api::org::delete_keyword))
        // Org-scoped user management. All mutating handlers gate on
        // require_org_admin so the read-only 'user' role can only GET the list.
        .route("/api/v1/org/users", get(api::org::list_org_users).post(api::org::create_org_user))
        .route("/api/v1/org/users/:user_id/status", patch(api::org::set_org_user_status))
        .route("/api/v1/org/users/:user_id/reset-password", post(api::org::reset_org_user_password))
        .route("/api/v1/org/users/:user_id", delete(api::org::delete_org_user))
        .route("/api/v1/events", post(handlers::ingest_events))
        .route("/api/v1/events", get(handlers::query_events))
        .route("/api/v1/events/summary", get(handlers::events_summary))
        .route("/api/v1/agents/enroll", post(handlers::enroll_agent))
        .route("/api/v1/agents/register", post(handlers::register_agent)) // legacy
        .route("/api/v1/agents/heartbeat", post(handlers::heartbeat))
        .route("/api/v1/agents/watchdog", post(handlers::report_watchdog))
        .route("/api/v1/agents/lifecycle", post(handlers::report_lifecycle))
        .route("/api/v1/agent/download", get(handlers::download_agent_installer))
        .route("/api/v1/agents", get(handlers::list_agents))
        .route("/api/v1/agents/:agent_id/events", delete(handlers::delete_agent_events))
        .route("/api/v1/agents/:agent_id/events/restore", put(handlers::restore_agent_events))
        .route("/api/v1/agents/:agent_id", delete(handlers::delete_agent))
        .route("/api/v1/agents/:agent_id/display-name", patch(handlers::update_agent_display_name))
        .route("/api/v1/files/upload", post(handlers::upload_file))
        .layer(axum::extract::DefaultBodyLimit::max(20 * 1024 * 1024)) // Allow up to 20MB for screenshot uploads
        .route("/api/v1/files/:file_id", get(handlers::download_file))
        .route("/api/v1/agents/:agent_id/archives", get(handlers::list_agent_archives))
        .route("/api/v1/agents/:agent_id/critical", get(handlers::list_agent_critical_files))
        .route("/api/v1/agents/:agent_id/screenshots", get(handlers::list_agent_screenshots))
        .route("/api/v1/agents/:agent_id/screenshot-duplicates", get(handlers::list_agent_screenshot_duplicates))
        .route("/api/v1/archives/:archive_id/download", post(handlers::download_archive))
        .route("/api/v1/archives", get(handlers::get_all_archives))
        .route("/api/v1/archives/collate", post(handlers::trigger_org_archive))
        .route("/api/v1/archives/download-bundle", post(handlers::download_org_bundle))
        .route("/api/v1/agents/:agent_id/archive", post(handlers::trigger_agent_archive))
        .layer(
            CorsLayer::new()
                .allow_origin(
                    config.cors_allowed_origins
                        .split(',')
                        .flat_map(|s| {
                            let s = s.trim();
                            vec![
                                s.parse::<axum::http::HeaderValue>().unwrap(),
                                format!("{}/", s).parse::<axum::http::HeaderValue>().unwrap(),
                            ]
                        })
                        .collect::<Vec<_>>()
                )
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PATCH,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([
                    axum::http::header::CONTENT_TYPE,
                    axum::http::header::AUTHORIZATION,
                    axum::http::header::COOKIE,
                    "X-Organization-Id".parse::<axum::http::HeaderName>().unwrap(),
                ])
                .allow_credentials(true)
        )
        .layer(axum::middleware::from_fn(secure_headers))
        .with_state(app_state);
    
    info!("Routes registered:");
    info!("  POST /api/v1/files/upload - File upload endpoint");
    info!("  GET  /api/v1/files/:file_id - File download endpoint");
    info!("  DELETE /api/v1/agents/:agent_id/events - Soft delete all events for agent");
    info!("  PUT /api/v1/agents/:agent_id/events/restore - Restore soft-deleted events");
    info!("  DELETE /api/v1/agents/:agent_id - Soft delete agent and all events");

    let addr = format!("{}:{}", config.host, config.port);
    info!("Server listening on {}", addr);

    let listener = TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

async fn health_check() -> StatusCode {
    StatusCode::OK
}

/// Returns the VPS wall-clock time as ms-since-epoch. Called by the dashboard
/// header so the on-screen clock reflects the server (Africa/Lagos) rather
/// than the viewer's browser — critical when analysts view from a laptop
/// whose OS timezone is misconfigured (US Central instead of WAT, etc.).
/// Public, unauthenticated — leaking wall-clock time is not sensitive.
async fn server_time() -> axum::Json<serde_json::Value> {
    axum::Json(serde_json::json!({
        "server_time_ms": chrono::Utc::now().timestamp_millis(),
    }))
}

async fn secure_headers(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    // 1. Content-Security-Policy (CSP) - Mitigate XSS
    // Note: We allow 'unsafe-inline' for styles due to some UI frameworks, but scripts are restricted.
    headers.insert(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' https://yikes.cam; frame-ancestors 'none';".parse().unwrap()
    );

    // 2. Clickjacking Protection
    headers.insert(
        "X-Frame-Options",
        "DENY".parse().unwrap()
    );

    // 3. MIME Sniffing Protection
    headers.insert(
        "X-Content-Type-Options",
        "nosniff".parse().unwrap()
    );

    // 4. HSTS (Strict-Transport-Security)
    // Force HTTPS for 1 year (only effective if served over HTTPS)
    headers.insert(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains".parse().unwrap()
    );

    // 5. Referrer Policy
    headers.insert(
        "Referrer-Policy",
        "strict-origin-when-cross-origin".parse().unwrap()
    );

    response
}
