use anyhow::Result;
use sqlx::{PgPool, Postgres, Transaction};
use std::sync::Arc;
use uuid::Uuid;

pub struct Database {
    pool: Arc<PgPool>,
}

impl Database {
    pub async fn new(database_url: &str) -> Result<Self> {
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
        sqlx::migrate!()
            .run(self.pool())
            .await
            .map_err(|e| anyhow::anyhow!("Migration failed: {}", e))?;
        Ok(())
    }

    /// Begin a transaction with RLS context set for a specific organization.
    /// All queries within this transaction will only see data for this org.
    pub async fn begin_rls_tx(&self, org_id: Uuid) -> Result<Transaction<'_, Postgres>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(&format!("SET LOCAL app.current_org_id = '{}'", org_id))
            .execute(&mut *tx)
            .await?;
        Ok(tx)
    }

    /// Begin a transaction with RLS bypass (super admin or agent-facing routes).
    /// All queries within this transaction will see ALL data across all orgs.
    pub async fn begin_bypass_tx(&self) -> Result<Transaction<'_, Postgres>, sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET LOCAL app.current_org_id = 'BYPASS'")
            .execute(&mut *tx)
            .await?;
        Ok(tx)
    }
}
