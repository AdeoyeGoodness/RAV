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
    pub scope: Option<String>,
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

        let claims = token_data.claims;

        // Backend Middleware: Enforce Restricted Scope
        if claims.scope.as_deref() == Some("password_reset_only") {
            let path = parts.uri.path();
            if !(parts.method == axum::http::Method::POST && path == "/api/v1/auth/change-password") {
                tracing::warn!("Blocked request to {} with restricted token", path);
                return Err(StatusCode::FORBIDDEN);
            }
        }

        Ok(claims)
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
        "SELECT id, organization_id, email, password_hash, role, full_name, status, created_at, updated_at, must_change_password FROM users WHERE email = $1 AND status = 'active'"
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
        must_change_password: user_row.get(9),
    };

    if !verify(payload.password, &user.password_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        // Audit password-mismatch attempts. Fire-and-forget on a fresh tx —
        // the login MUST 401 the caller regardless of whether the audit
        // insert succeeds, so we don't propagate that error.
        if let Ok(mut audit_tx) = pool.begin().await {
            let _ = log_audit(
                &mut audit_tx,
                ActorType::System,
                Some(user.id),
                user.organization_id,
                "USER_LOGIN_FAILED",
                "user",
                Some(user.id.to_string()),
                serde_json::json!({ "email": user.email, "reason": "bad_password" }),
                None, None,
            ).await;
            let _ = audit_tx.commit().await;
        }
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

    let scope = if user.must_change_password {
        Some("password_reset_only".to_string())
    } else {
        Some("full".to_string())
    };

    let claims = Claims {
        sub: user.id,
        exp,
        role: user.role.clone(),
        org_id: user.organization_id,
        scope,
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

    // Audit every successful login (super_admin, org_admin, user). Analysts
    // are stamped as OrgAdmin in the enum bucket + { actor_role: "user" }
    // in metadata since actor_type has only three values today — see the
    // plan doc for the enum-value deferral rationale.
    if let Ok(mut audit_tx) = pool.begin().await {
        let actor_type = if user.role == "super_admin" {
            ActorType::SuperAdmin
        } else {
            ActorType::OrgAdmin
        };
        let _ = log_audit(
            &mut audit_tx,
            actor_type,
            Some(user.id),
            user.organization_id,
            "USER_LOGIN",
            "user",
            Some(user.id.to_string()),
            serde_json::json!({ "email": user.email, "actor_role": user.role }),
            None,
            None,
        ).await;
        let _ = audit_tx.commit().await;
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
            must_change_password: user.must_change_password,
        },
    });

    Ok((
        [(SET_COOKIE, cookie)],
        body
    ))
}

pub async fn register(
    claims: Option<Claims>,
    State(state): State<AppState>,
    Json(payload): Json<CreateUser>,
) -> Result<Json<UserResponse>, StatusCode> {
    // Writes must go through a bypass transaction: the users table has
    // FORCE ROW LEVEL SECURITY, and the plain pool connection has no
    // app.current_org_id set, so inserts are rejected. login/me do the same.
    let mut tx = state.db.begin_bypass_tx().await.map_err(|e| {
        tracing::error!("Failed to start bypass tx for register: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // First-run bootstrap vs. locked-down access control:
    //   * While NO super admin exists, registration is open (no auth) so the
    //     initial super admin can be created via create_admin.js. The first
    //     account is required to be a super_admin.
    //   * Once a super admin exists, the caller must be an authenticated
    //     super admin (this is the path the dashboard admin page uses).
    let super_admin_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE role = 'super_admin' AND status = 'active'"
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to count super admins: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if super_admin_count == 0 {
        // Bootstrap: the first account must itself be a super admin.
        if payload.role != "super_admin" {
            tracing::warn!(
                "Bootstrap register rejected: first account must be super_admin, got '{}'",
                payload.role
            );
            return Err(StatusCode::FORBIDDEN);
        }
    } else {
        // Locked down: require an authenticated super admin.
        match &claims {
            Some(c) if c.role == "super_admin" => {}
            Some(c) => {
                tracing::warn!(
                    "Register denied: user {} (role {}) is not super_admin",
                    c.sub, c.role
                );
                return Err(StatusCode::FORBIDDEN);
            }
            None => return Err(StatusCode::UNAUTHORIZED),
        }
    }

    let password_hash = hash(payload.password, DEFAULT_COST).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_row = sqlx::query(
        r#"
        INSERT INTO users (id, organization_id, email, password_hash, role, full_name, must_change_password)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id, organization_id, email, password_hash, role, full_name, status, created_at, updated_at, must_change_password
        "#
    )
    .bind(Uuid::new_v4())
    .bind(payload.organization_id)
    .bind(&payload.email)
    .bind(password_hash)
    .bind(&payload.role)
    .bind(&payload.full_name)
    .bind(payload.must_change_password)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to create user: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    tx.commit().await.map_err(|e| {
        tracing::error!("Failed to commit register tx: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(UserResponse {
        id: user_row.get(0),
        organization_id: user_row.get(1),
        email: user_row.get(2),
        role: user_row.get(4),
        full_name: user_row.get(5),
        must_change_password: user_row.get(9),
    }))
}

pub async fn me(
    claims: Claims,
    State(state): State<AppState>,
) -> Result<Json<UserResponse>, StatusCode> {
    let pool = state.db.pool();
    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_row = sqlx::query(
        "SELECT id, organization_id, email, password_hash, role, full_name, status, created_at, updated_at, must_change_password FROM users WHERE id = $1 AND status = 'active'"
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
        must_change_password: user_row.get(9),
    }))
}

pub async fn logout() -> impl IntoResponse {
    let cookie = "rav_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
    [(SET_COOKIE, cookie)]
}

pub async fn change_password(
    claims: Claims,
    State(state): State<AppState>,
    Json(payload): Json<crate::db::models::ChangePasswordRequest>,
) -> Result<impl IntoResponse, StatusCode> {
    let mut tx = state.db.begin_bypass_tx().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let user_row = sqlx::query(
        "SELECT password_hash FROM users WHERE id = $1 AND status = 'active'"
    )
    .bind(claims.sub)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch user for password change: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?
    .ok_or(StatusCode::UNAUTHORIZED)?;

    let current_hash: String = user_row.get(0);
    if !verify(&payload.current_password, &current_hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? {
        return Err(StatusCode::UNAUTHORIZED);
    }

    if payload.current_password == payload.new_password {
        return Err(StatusCode::BAD_REQUEST);
    }

    let new_hash = hash(&payload.new_password, DEFAULT_COST).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    sqlx::query(
        "UPDATE users SET password_hash = $1, must_change_password = false, password_changed_at = NOW() WHERE id = $2"
    )
    .bind(new_hash)
    .bind(claims.sub)
    .execute(&mut *tx)
    .await
    .map_err(|e| {
        tracing::error!("Failed to update user password: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    if let Some(org_id) = claims.org_id {
        sqlx::query(
            "UPDATE organizations SET admin_verified = true WHERE id = $1"
        )
        .bind(org_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| {
            tracing::error!("Failed to verify organization admin: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;
    }

    // Audit the self-service password change. Same tx so the audit is
    // atomic with the update — either both land or neither does.
    let actor_type = if claims.role == "super_admin" {
        ActorType::SuperAdmin
    } else {
        ActorType::OrgAdmin
    };
    let _ = log_audit(
        &mut tx,
        actor_type,
        Some(claims.sub),
        claims.org_id,
        "USER_PASSWORD_CHANGED",
        "user",
        Some(claims.sub.to_string()),
        serde_json::json!({ "actor_role": claims.role }),
        None, None,
    ).await;

    tx.commit().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let exp = Utc::now()
        .checked_add_signed(Duration::hours(24))
        .expect("valid timestamp")
        .timestamp() as usize;

    let new_claims = Claims {
        sub: claims.sub,
        exp,
        role: claims.role.clone(),
        org_id: claims.org_id,
        scope: Some("full".to_string()),
    };

    let token = encode(
        &Header::default(),
        &new_claims,
        &EncodingKey::from_secret(state.config.jwt_secret.as_bytes()),
    )
    .map_err(|e| {
        tracing::error!("JWT encoding failed during password change: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let cookie = format!(
        "rav_token={}; HttpOnly; Path=/; SameSite=Lax; Max-Age={}",
        token,
        24 * 60 * 60
    );

    Ok(([(SET_COOKIE, cookie)], StatusCode::OK))
}
