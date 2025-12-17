use anyhow::Result;
use sqlx::PgPool;
use std::sync::Arc;

pub struct Database {
    pool: Arc<PgPool>,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self> {
        // Configure connection pool with better timeout settings
        let pool_options = sqlx::postgres::PgPoolOptions::new()
            .max_connections(10)
            .acquire_timeout(std::time::Duration::from_secs(30))
            .idle_timeout(std::time::Duration::from_secs(600))
            .max_lifetime(std::time::Duration::from_secs(1800));
        
        let pool = pool_options
            .connect(database_url)
            .await
            .map_err(|e| anyhow::anyhow!("Failed to connect to database: {}", e))?;

        Ok(Self {
            pool: Arc::new(pool),
        })
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn run_migrations(&self) -> Result<()> {
        sqlx::migrate!("src/db/migrations")
            .run(self.pool())
            .await
            .map_err(|e| anyhow::anyhow!("Migration failed: {}", e))?;
        Ok(())
    }
}

