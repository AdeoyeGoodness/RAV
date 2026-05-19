use axum::{
    async_trait,
    extract::{State, FromRequestParts, FromRef},
    http::{StatusCode, request::Parts, header::{SET_COOKIE, COOKIE}},
    response::IntoResponse,
    Json,
};
use bcrypt::{hash, verify, DEFAULT_COST};
use jsonwebtoken::{encode, decode, Header, EncodingKey, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{Utc, Duration};
use crate::AppState;
use crate::db::models::{User, CreateUser, LoginRequest, AuthResponse, UserResponse, ActorType};
use crate::services::audit::log_audit;
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
        // 1. Try to extract from HttpOnly Cookie
        let token = if let Some(cookie_header) = parts.headers.get(COOKIE) {
            cookie_header.to_str()
                .ok()
                .and_then(|c| {
                    c.split(';')
                        .find(|s| s.trim().starts_with("rav_token="))
                        .map(|s| s.trim().trim_start_matches("rav_token="))
                })
        } else {
            None
        };

        // 2. Fallback to Bearer Header (Transitionary support)
        let token = match token {
            Some(t) => t,
            None => {
                let auth_header = parts.headers.get("Authorization")
                    .and_then(|h| h.to_str().ok())
                    .ok_or(StatusCode::UNAUTHORIZED)?;
                
                if !auth_header.starts_with("Bearer ") {
                   return Err(StatusCode::UNAUTHORIZED);
                }
                &auth_header[7..]
            }
        };

        let mut validation = Validation::default();
        validation.leeway = 300; // 5 minutes leeway for clock drift

        let token_data = decode::<Claims>(
            token,
            &DecodingKey::from_secret(state.config.jwt_secret.as_bytes()),
            &validation,
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
) -> Result<impl IntoResponse, StatusCode> {
    let pool = state.db.pool();
    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Failed to start bypass tx for login: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let user_row = sqlx::query(
        "SELECT id, organization_id, email, password_hash, role, full_name, status, created_at, updated_at FROM users WHERE email = $1 AND status = 'active'"
    )
    .bind(&payload.email)
    .fetch_optional(&mut *tx)
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

    // Organization Access Guard (Multi-tenant Expiry Fix)
    // Super Admins are exempt from organization-level expiry checks to prevent platform lockout
    if user.role != "super_admin" {
        if let Some(org_id) = user.organization_id {
            let org = sqlx::query!(
                "SELECT status, token_expiry FROM organizations WHERE id = $1",
                org_id
            )
            .fetch_one(pool)
            .await
            .map_err(|e| {
                tracing::error!("Failed to fetch org for login check: {}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?;

            if org.status != "active" {
                return Err(StatusCode::FORBIDDEN);
            }

            if let Some(expiry) = org.token_expiry {
                if expiry < Utc::now() {
                    return Err(StatusCode::PAYMENT_REQUIRED);
                }
            }
        }
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

    // Audit Log for Admins
    if user.role == "super_admin" || user.role == "org_admin" {
        // We need a transaction for audit log
        if let Ok(mut tx) = pool.begin().await {
            let actor_type = if user.role == "super_admin" { ActorType::SuperAdmin } else { ActorType::OrgAdmin };
            
            // Fire and forget audit (log error but don't fail login)
            let _ = log_audit(
                &mut tx,
                actor_type,
                Some(user.id),
                user.organization_id,
                "USER_LOGIN",
                "USER",
                Some(user.id.to_string()),
                serde_json::json!({ "email": user.email }),
                None, // IP TODO: Extract from headers if possible
                None
            ).await;
            
            let _ = tx.commit().await;
        }
    }

    // Set HttpOnly Cookie (Session only, no Max-Age)
    let cookie = format!(
        "rav_token={}; HttpOnly; Path=/; SameSite=Lax",
        token
    );

    let body = Json(AuthResponse {
        token: "".to_string(), // Removed from body for security
        user: UserResponse {
            id: user.id,
            organization_id: user.organization_id,
            email: user.email,
            role: user.role,
            full_name: user.full_name,
        },
    });

    Ok((
        [(SET_COOKIE, cookie)],
        body
    ))
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

pub async fn me(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<UserResponse>, StatusCode> {
    let pool = state.db.pool();
    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_row = sqlx::query(
        "SELECT id, organization_id, email, password_hash, role, full_name, status, created_at, updated_at FROM users WHERE id = $1 AND status = 'active'"
    )
    .bind(claims.sub)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Me query failed: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    // Organization Access Guard (Session validation)
    let role: String = user_row.get(4);
    if role != "super_admin" {
        let org_id: Option<Uuid> = user_row.get(1);
        if let Some(oid) = org_id {
            let org = sqlx::query!(
                "SELECT status, token_expiry FROM organizations WHERE id = $1",
                oid
            )
            .fetch_one(pool)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            if org.status != "active" {
                return Err(StatusCode::FORBIDDEN);
            }

            if let Some(expiry) = org.token_expiry {
                if expiry < Utc::now() {
                    return Err(StatusCode::PAYMENT_REQUIRED);
                }
            }
        }
    }

    Ok(Json(UserResponse {
        id: user_row.get(0),
        organization_id: user_row.get(1),
        email: user_row.get(2),
        role: user_row.get(4),
        full_name: user_row.get(5),
    }))
}

pub async fn logout() -> impl IntoResponse {
    let cookie = "rav_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
    [(SET_COOKIE, cookie)]
}
