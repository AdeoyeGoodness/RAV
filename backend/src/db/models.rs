use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Organization {
    pub id: Uuid,
    pub name: String,
    pub enrollment_token: String,
    pub status: String,
    pub max_agents: i32,
    pub token_expiry: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Agent {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub agent_id: String,
    pub hardware_fingerprint: String,
    pub hostname: Option<String>,
    pub last_seen: DateTime<Utc>,
    pub token_expiry: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Event {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub agent_id: String,
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub metadata: serde_json::Value,
    pub severity: String,
    pub category: String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEvent {
    pub organization_id: Option<Uuid>,
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub agent_id: String,
    pub metadata: serde_json::Value,
    pub severity: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgent {
    pub agent_id: String,
    pub hardware_fingerprint: String,
    pub enrollment_token: String,
    pub hostname: Option<String>,
    pub os_version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heartbeat {
    pub agent_id: String,
    pub hardware_fingerprint: String,
    pub timestamp: DateTime<Utc>,
    pub version: String,
    pub hostname: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub organization_id: Option<Uuid>,
    pub email: String,
    pub password_hash: String,
    pub role: String, // super_admin, org_admin, org_user
    pub full_name: Option<String>,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateUser {
    pub organization_id: Option<Uuid>,
    pub email: String,
    pub password: String,
    pub role: String,
    pub full_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthResponse {
    pub token: String,
    pub user: UserResponse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub organization_id: Option<Uuid>,
    pub email: String,
    pub role: String,
    pub full_name: Option<String>,
}


#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, sqlx::Type)]
#[sqlx(type_name = "actor_type", rename_all = "snake_case")]
pub enum ActorType {
    SuperAdmin,
    OrgAdmin,
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AuditLog {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub actor_type: ActorType,
    pub actor_id: Option<Uuid>,
    pub organization_id: Option<Uuid>,
    pub action_type: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub metadata: serde_json::Value,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAuditLog {
    pub actor_type: ActorType,
    pub actor_id: Option<Uuid>,
    pub organization_id: Option<Uuid>,
    pub action_type: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub metadata: serde_json::Value,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EnrichedAuditLog {
    pub id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub actor_type: ActorType,
    pub actor_id: Option<Uuid>,
    pub organization_id: Option<Uuid>,
    pub action_type: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub metadata: serde_json::Value,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    // Enriched fields from JOIN
    pub actor_email: Option<String>,
    pub actor_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Archive {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub agent_id: String,
    pub filename: String,
    pub size_bytes: i64,
    pub event_count: i32,
    pub start_date: DateTime<Utc>,
    pub end_date: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OrganizationSettings {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub smtp_host: Option<String>,
    pub smtp_port: Option<i32>,
    pub smtp_username: Option<String>,
    pub smtp_password_encrypted: Option<String>,
    pub smtp_from_email: Option<String>,
    pub smtp_enabled: bool,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateOrganizationSettings {
    pub smtp_host: Option<String>,
    pub smtp_port: Option<i32>,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from_email: Option<String>,
    pub smtp_enabled: Option<bool>,
    pub verify_password: String, // Required to save sensitive data
}
