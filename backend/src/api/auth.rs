use axum::{
    async_trait,
    extract::{State, FromRequestParts, FromRef},
    http::{StatusCode, request::Parts},
    Json,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{encode, decode, Header, EncodingKey, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{Utc, Duration};
use crate::AppState;
use crate::db::models::{User, CreateUser, LoginRequest, AuthResponse, UserResponse};
use sqlx::{Row};

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub exp: usize,
    pub role: String,
    pub org_id: Option<Uuid>,
}

#[async_trait]
impl FromRequestParts<AppState> for Claims
{
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|h| h.to_str().ok())
            .ok_or(StatusCode::UNAUTHORIZED)?;

        if !auth_header.starts_with("Bearer ") {
            return Err(StatusCode::UNAUTHORIZED);
        }

        let token = &auth_header[7..];

        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
            &Validation::default(),
        )
        .map_err(|e| {
            tracing::error!("JWT validation failed: {}", e);
            StatusCode::UNAUTHORIZED
        })?;

        Ok(token_data.claims)
    }
}

pub async fn login(
    State(state): State<AppState>,
    Json(payload): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let pool = state.db.pool();

    let user_row = sqlx::query(
        "SELECT id, organization_id, email, password_hash, role, full_name, status, created_at, updated_at FROM users WHERE email = $1 AND status = 'active'"
    )
    .bind(&payload.email)
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::error!("Auth query failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    let user = User {
        id: user_row.get(0),
        organization_id: user_row.get(1),
        email: user_row.get(2),
        password_hash: user_row.get(3),
        role: user_row.get(4),
        full_name: user_row.get(5),
        status: user_row.get(6),
        created_at: user_row.get(7),
        updated_at: user_row.get(8),
    };

    if !verify(payload.password, &user.password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let exp = Utc::now()
        .checked_add_signed(Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let claims = Claims {
        sub: user.id,
        exp,
        role: user.role.clone(),
        org_id: user.organization_id,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.config.jwt_secret.as_bytes()),
    )
    .map_err(|e| {
        tracing::error!("JWT encoding failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(AuthResponse {
        token,
        user: UserResponse {
            id: user.id,
            organization_id: user.organization_id,
            email: user.email,
            role: user.role,
            full_name: user.full_name,
        },
    }))
}

pub async fn register(
    State(state): State<AppState>,
    Json(payload): Json<CreateUser>,
) -> Result<Json<UserResponse>, StatusCode> {
    let pool = state.db.pool();

    let password_hash = hash(payload.password, DEFAULT_COST).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_row = sqlx::query(
        r#"
        INSERT INTO users (id, organization_id, email, password_hash, role, full_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, organization_id, email, password_hash, role, full_name, status, created_at, updated_at
        "#
    )
    .bind(Uuid::new_v4())
    .bind(payload.organization_id)
    .bind(&payload.email)
    .bind(password_hash)
    .bind(&payload.role)
    .bind(&payload.full_name)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create user: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(UserResponse {
        id: user_row.get(0),
        organization_id: user_row.get(1),
        email: user_row.get(2),
        role: user_row.get(4),
        full_name: user_row.get(5),
    }))
}
