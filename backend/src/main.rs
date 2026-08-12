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

    // Spawn Background OCR Sweep — every 60s, claim up to N pending files,
    // OCR each, match keywords, write flags back. Cheap when idle (single SQL
    // query returns zero rows), heavy per file when there's a backlog. Bounded
    // by batch_size so we can't peg the CPU.
    let ocr_bg = ocr_service.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            let batch = match ocr_bg.claim_batch().await {
                Ok(b) => b,
                Err(e) => {
                    tracing::error!("OCR: claim_batch failed: {}", e);
                    continue;
                }
            };
            if batch.is_empty() {
                continue;
            }
            info!("OCR: processing {} pending file(s)", batch.len());
            for file in batch {
                if let Err(e) = ocr_bg.process_one(file).await {
                    tracing::error!("OCR: process_one failed: {}", e);
                }
            }
        }
    });

    // Spawn Background Archiver Job
    let archive_bg = archive_service.clone();
    let notify_bg = notification_service.clone();
    let encryption_bg = encryption_service.clone();
    let db_bg = db.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(12 * 3600)).await; // Run every 12 hours
            info!("Running automated archive rotation check...");
            
            // Cross-org scan for agents with events older than 7 days. events has
            // FORCE RLS, so this must run in a BYPASS transaction or it sees nothing.
            let result = async {
                let mut tx = db_bg.begin_bypass_tx().await?;
                let rows = sqlx::query!(
                    r#"
                    SELECT DISTINCT agent_id, organization_id
                    FROM events
                    WHERE created_at < NOW() - INTERVAL '7 days'
                    "#
                )
                .fetch_all(&mut *tx)
                .await?;
                tx.commit().await?;
                Ok::<_, sqlx::Error>(rows)
            }
            .await;

            if let Ok(targets) = result {
                for target in targets {
                    if let Ok(Some(_arch)) = archive_bg.archive_agent_telemetry(&target.agent_id, target.organization_id, false).await {
                        // Notify admins (DB-backed + Encrypted SMTP)
                        let _ = notify_bg.notify_archive_ready(target.organization_id, &target.agent_id, &encryption_bg).await;
                    }
                }
            }

            // 2-day vault retention sweep. Admins have 2 days to download an archive
            // after it lands in the vault; after that we reclaim the disk.
            if let Err(e) = archive_bg.cleanup_old_archives(2).await {
                tracing::error!("Archive cleanup failed: {}", e);
            }

            // 7-day file/screenshot sweep. Event rows older than 7 days are archived and
            // purged above; without this the underlying blobs in storage/files/ and the
            // files table would grow forever, which is what makes the endpoint detail page
            // and screenshot loads slow down over time.
            if let Err(e) = archive_bg.cleanup_old_files(7).await {
                tracing::error!("File cleanup failed: {}", e);
            }
        }
    });
    
    // Build application
    let app = Router::new()
        .route("/health", get(health_check))
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
        .route("/api/v1/admin/audits", get(api::admin::list_audit_logs))
        .route("/api/v1/org/me", get(api::org::get_current_org))
        .route("/api/v1/org/stats", get(api::org::get_org_stats))
        .route("/api/v1/org/settings", get(handlers::get_org_settings))
        .route("/api/v1/org/settings", patch(handlers::update_org_settings))
        .route("/api/v1/org/settings/verify", post(handlers::verify_identity))
        .route("/api/v1/org/settings/test", post(handlers::test_org_settings))
        .route("/api/v1/org/audits", get(api::org::list_org_audit_logs))
        .route("/api/v1/org/enrollment-tokens", get(api::org::list_enrollment_tokens).post(api::org::create_enrollment_token))
        .route("/api/v1/org/enrollment-tokens/:token_id", delete(api::org::revoke_enrollment_token))
        .route("/api/v1/org/keywords", get(api::org::list_keywords).post(api::org::create_keyword))
        .route("/api/v1/org/keywords/:id", delete(api::org::delete_keyword))
        .route("/api/v1/events", post(handlers::ingest_events))
        .route("/api/v1/events", get(handlers::query_events))
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
        "default-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' https://rav.handy.boats; frame-ancestors 'none';".parse().unwrap()
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
