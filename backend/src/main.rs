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
mod config;

use api::handlers;
use config::AppConfig;
use db::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Database>,
    pub config: Arc<AppConfig>,
    pub file_storage_dir: std::path::PathBuf,
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
    
    let app_state = AppState {
        db: db.clone(),
        config: config.clone(),
        file_storage_dir: file_storage_dir.clone(),
        server_start_time: chrono::Utc::now(),
    };
    
    // Build application
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/api/v1/auth/login", post(api::auth::login))
        .route("/api/v1/auth/register", post(api::auth::register))
        .route("/api/v1/admin/organizations", get(api::admin::list_organizations))
        .route("/api/v1/admin/organizations", post(api::admin::create_organization))
        .route("/api/v1/admin/organizations/:id/status", patch(api::admin::update_organization_status))
        .route("/api/v1/admin/organizations/:id", patch(api::admin::update_organization))
        .route("/api/v1/admin/stats", get(api::admin::get_platform_stats))
        .route("/api/v1/admin/health", get(api::admin::get_system_health))
        .route("/api/v1/admin/organizations/:id", delete(api::admin::delete_organization))
        .route("/api/v1/events", post(handlers::ingest_events))
        .route("/api/v1/events", get(handlers::query_events))
        .route("/api/v1/agents/enroll", post(handlers::enroll_agent))
        .route("/api/v1/agents/register", post(handlers::register_agent)) // legacy
        .route("/api/v1/agents/heartbeat", post(handlers::heartbeat))
        .route("/api/v1/agents", get(handlers::list_agents))
        .route("/api/v1/agents/:agent_id/events", delete(handlers::delete_agent_events))
        .route("/api/v1/agents/:agent_id/events/restore", put(handlers::restore_agent_events))
        .route("/api/v1/agents/:agent_id", delete(handlers::delete_agent))
        .route("/api/v1/files/upload", post(handlers::upload_file))
        .route("/api/v1/files/:file_id", get(handlers::download_file))
        .layer(CorsLayer::permissive())
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
