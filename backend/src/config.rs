use anyhow::Result;
use std::env;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub s3_endpoint: String,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub s3_bucket: String,
    pub redis_url: String,
    pub jwt_secret: String,
    pub cors_allowed_origins: String,
}

impl AppConfig {
    pub fn load() -> Result<Self> {
        Ok(Self {
            host: env::var("BACKEND_HOST")
                .unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("BACKEND_PORT")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(8080),
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgresql://rav_user:rav_password@localhost:5434/rav_db".to_string()),
            s3_endpoint: env::var("S3_ENDPOINT")
                .unwrap_or_else(|_| "http://localhost:9000".to_string()),
            s3_access_key: env::var("S3_ACCESS_KEY")
                .unwrap_or_else(|_| "minioadmin".to_string()),
            s3_secret_key: env::var("S3_SECRET_KEY")
                .unwrap_or_else(|_| "minioadmin".to_string()),
            s3_bucket: env::var("S3_BUCKET")
                .unwrap_or_else(|_| "rav-evidence".to_string()),
            redis_url: env::var("REDIS_URL")
                .unwrap_or_else(|_| "redis://localhost:6379".to_string()),
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "change-me-in-production".to_string()),
            cors_allowed_origins: env::var("cors_allowed_origins")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
        })
    }
}

