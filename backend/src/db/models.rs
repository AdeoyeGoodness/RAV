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
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEvent {
    pub organization_id: Option<Uuid>,
    pub event_type: String,
    pub timestamp: DateTime<Utc>,
    pub agent_id: String,
    pub metadata: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgent {
    pub agent_id: String,
    pub hardware_fingerprint: String,
    pub hardware_fingerprint: String,
    pub enrollment_token: String,
    pub hostname: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heartbeat {
    pub agent_id: String,
    pub hardware_fingerprint: String,
    pub timestamp: DateTime<Utc>,
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

