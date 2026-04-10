use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use crate::config::AppConfig;
use crate::db::models::OrganizationSettings;
use crate::services::crypto::EncryptionService;
use anyhow::{Result, Context};
use tracing::{info, error};
use std::sync::Arc;
use sqlx::PgPool;
use uuid::Uuid;

pub struct NotificationService {
    config: Arc<AppConfig>,
    pool: PgPool,
}

impl NotificationService {
    pub fn new(config: Arc<AppConfig>, pool: PgPool) -> Self {
        Self { config, pool }
    }

    /// Fetches org settings, decrypts password, and sends forensic alert to all admins.
    pub async fn notify_archive_ready(
        &self, 
        org_id: Uuid, 
        agent_id: &str, 
        encryption_service: &EncryptionService
    ) -> Result<()> {
        // 1. Fetch Settings
        let settings = sqlx::query_as!(
            OrganizationSettings,
            "SELECT * FROM organization_settings WHERE organization_id = $1",
            org_id
        )
        .fetch_optional(&self.pool)
        .await?;

        let settings = match settings {
            Some(s) if s.smtp_enabled => s,
            _ => {
                info!("Archiving notification skipped for Org {}: SMTP not configured or disabled.", org_id);
                return Ok(());
            }
        };

        // 2. Fetch Admin Emails
        let admins = sqlx::query!(
            "SELECT email FROM users WHERE organization_id = $1 AND role IN ('org_admin', 'super_admin') AND status = 'active'",
            org_id
        )
        .fetch_all(&self.pool)
        .await?;

        if admins.is_empty() {
            return Ok(());
        }

        // 3. Prepare SMTP Transport
        let host = settings.smtp_host.context("SMTP Host missing")?;
        let port = settings.smtp_port.unwrap_or(587) as u16;
        let from = settings.smtp_from_email.unwrap_or_else(|| self.config.smtp_from.clone());
        
        let mut mailer_builder = SmtpTransport::relay(&host)?.port(port);

        if let (Some(user), Some(enc_pass)) = (settings.smtp_username.as_ref(), settings.smtp_password_encrypted.as_ref()) {
            let pass = encryption_service.decrypt(enc_pass).context("Failed to decrypt SMTP password")?;
            mailer_builder = mailer_builder.credentials(Credentials::new(user.clone(), pass));
        }

        let mailer = mailer_builder.build();

        // 4. Send Emails
        for admin in admins {
            let email = Message::builder()
                .from(from.parse().context("Invalid sender")?)
                .to(admin.email.parse().context("Invalid recipient")?)
                .subject(format!("RAV FORENSIC ALERT: Archive Ready ({})", agent_id))
                .body(format!(
                    "SECURITY NOTICE: A new forensic telemetry archive has been generated for Agent: {}.\n\nAccess it via the RAV Dashboard.\n\nCRITICAL: This archive adheres to the 'Burn After Reading' policy. It will be permanently deleted from the vault immediately after download.\n\nAutomated Alert System",
                    agent_id
                ))?;

            let _ = mailer.send(&email);
            info!("Forensic archive notification dispatched to {}", admin.email);
        }

        Ok(())
    }
}
