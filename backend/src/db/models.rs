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
    pub admin_verified: bool,
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
    pub deleted_at: Option<DateTime<Utc>>,
    pub last_archived_at: Option<DateTime<Utc>>,
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
    pub severity: Option<String>,
    pub category: Option<String>,
    pub deleted_at: Option<DateTime<Utc>>,
    pub observed: Option<bool>,
    pub received_at: Option<DateTime<Utc>>,
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

/// Watchdog snapshot posted by the endpoint-side Scheduled Task. Lets the
/// backend distinguish a killed/crashed service (state=Stopped, binary
/// present) from a removed agent (NotInstalled or binary missing).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WatchdogReport {
    pub agent_id: String,
    pub hostname: Option<String>,
    pub service_state: String,    // "Running" | "Stopped" | "NotInstalled" | "Unknown"
    pub binary_present: bool,
    pub watchdog_version: Option<String>,
}

/// Lifecycle event posted by the MAIN agent on graceful startup/shutdown so a
/// recent "stopping" before silence means admin-initiated, not crash/killed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleEvent {
    pub agent_id: String,
    pub state: String,            // "started" | "stopping" | "uninstalling"
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct User {
    pub id: Uuid,
    pub organization_id: Option<Uuid>,
    pub email: String,
    pub password_hash: String,
    pub role: String, // super_admin, org_admin, org_user
    pub full_name: Option<String>,
    pub must_change_password: bool,
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
    pub must_change_password: bool,
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
    pub must_change_password: bool,
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
    pub smtp_enabled: Option<bool>,
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

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct EnrollmentToken {
    pub token_id: Uuid,
    pub org_id: Uuid,
    pub label: Option<String>,
    pub max_agents: Option<i32>,
    pub expires_at: Option<DateTime<Utc>>,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
    /// Agents currently enrolled under this token (non-deleted). Used for capacity accounting
    /// so an expired token still counts the agents actually running under it.
    #[sqlx(default)]
    pub agent_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEnrollmentToken {
    pub label: Option<String>,
    pub max_agents: Option<i32>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnrollmentTokenResponse {
    pub token_id: Uuid,
    pub raw_token: Option<String>, // ONLY returned once upon creation
    pub label: Option<String>,
    pub max_agents: Option<i32>,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangePasswordRequest {
    pub current_password: String,
    pub new_password: String,
}
