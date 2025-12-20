use crate::db::models::{ActorType, CreateAuditLog};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

pub async fn log_audit(
    tx: &mut Transaction<'_, Postgres>,
    actor_type: ActorType,
    actor_id: Option<Uuid>,
    organization_id: Option<Uuid>,
    action_type: &str,
    target_type: &str,
    target_id: Option<String>,
    metadata: serde_json::Value,
    ip_address: Option<String>,
    user_agent: Option<String>
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO audit_logs (
            actor_type, actor_id, organization_id, action_type, 
            target_type, target_id, metadata, ip_address, user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
        actor_type as ActorType,
        actor_id,
        organization_id,
        action_type,
        target_type,
        target_id,
        metadata,
        ip_address,
        user_agent
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}
