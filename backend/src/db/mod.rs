pub mod models;
pub mod pool;

use anyhow::Result;
use sqlx::PgPool;

pub use pool::Database;

pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    sqlx::migrate!()
        .run(pool)
        .await
        .map_err(|e| anyhow::anyhow!("Migration failed: {}", e))?;
    Ok(())
}

