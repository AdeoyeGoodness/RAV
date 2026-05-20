use crate::db::models::{Event, Archive};
use sqlx::{PgPool, Postgres, Transaction};
use anyhow::{Result, Context};
use chrono::{DateTime, Utc, Duration};
use std::fs;
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use std::io::Write;
use uuid::Uuid;
use tracing::{info, warn};

pub struct ArchiveService {
    pool: PgPool,
    storage_dir: PathBuf,
    /// Where uploaded screenshot blobs live ({file_id}.{ext}); used to embed images in the PDF.
    file_storage_dir: PathBuf,
    /// Max screenshots embedded per report (protects against huge PDFs/OOM).
    max_screenshots: usize,
}

impl ArchiveService {
    pub fn new(pool: PgPool, storage_dir: PathBuf, file_storage_dir: PathBuf, max_screenshots: usize) -> Self {
        if !storage_dir.exists() {
            fs::create_dir_all(&storage_dir).expect("Failed to create archive storage directory");
        }
        Self { pool, storage_dir, file_storage_dir, max_screenshots }
    }

    pub fn storage_dir(&self) -> &Path {
        &self.storage_dir
    }

    /// Primary task: Archive events for an agent. 
    /// By default (weekly pulse), it only takes events older than 7 days.
    /// If 'include_recent' is true (manual request), it takes everything.
    pub async fn archive_agent_telemetry(&self, agent_id: &str, org_id: Uuid, include_recent: bool) -> Result<Option<Archive>> {
        let now = Utc::now();
        let cutoff = if include_recent {
            now
        } else {
            now - Duration::days(7)
        };

        // All events/archives queries run inside ONE org-scoped transaction. The
        // events/archives tables have FORCE row-level security (migration 014); without
        // SET LOCAL app.current_org_id the policies are fail-closed and every SELECT/
        // INSERT/DELETE here silently affects nothing. One tx also closes the gap
        // between reading the events and purging them.
        let mut tx = self.pool.begin().await?;
        sqlx::query(&format!("SET LOCAL app.current_org_id = '{}'", org_id))
            .execute(&mut *tx)
            .await?;

        // 1. Fetch events for the window
        let events = sqlx::query_as!(
            Event,
            r#"
            SELECT * FROM events
            WHERE agent_id = $1 AND organization_id = $2 AND created_at < $3
            ORDER BY created_at ASC
            "#,
            agent_id,
            org_id,
            cutoff
        )
        .fetch_all(&mut *tx)
        .await?;

        if events.is_empty() {
            return Ok(None);
        }

        let event_count = events.len() as i32;
        let start_date = events.first().unwrap().created_at;
        let end_date = events.last().unwrap().created_at;

        // 2. Prepare JSON Payload (kept for machine analysis)
        let json_data = serde_json::to_string_pretty(&events)?;

        // 3. Create ZIP file
        let archive_id = Uuid::new_v4();
        let prefix = if include_recent { "MANUAL" } else { "WEEKLY" };
        let filename = format!("{}_{}_{}.zip", prefix, agent_id, archive_id);
        let archive_path = self.storage_dir.join(&filename);

        let file = fs::File::create(&archive_path)?;
        let mut zip = zip::ZipWriter::new(file);
        let options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);

        zip.start_file("events.json", options)?;
        zip.write_all(json_data.as_bytes())?;

        // Human-readable PDF reports — one per section. A failure here must NOT abort
        // archiving/purge; we still ship the JSON-only zip and proceed.
        match crate::services::report::generate_section_reports(
            agent_id,
            agent_id,
            "",
            &events,
            &self.file_storage_dir,
            self.max_screenshots,
        ) {
            Ok(reports) => {
                for (name, bytes) in reports {
                    zip.start_file(&name, options)?;
                    zip.write_all(&bytes)?;
                }
            }
            Err(e) => {
                warn!("PDF report generation failed for {}: {} — archiving JSON only", agent_id, e);
            }
        }

        zip.finish()?;

        let size_bytes = fs::metadata(&archive_path)?.len() as i64;

        // 4. Record Archive in DB and Purge Events (same org-scoped transaction)
        sqlx::query!(
            r#"
            INSERT INTO archives (id, organization_id, agent_id, filename, size_bytes, event_count, start_date, end_date, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            "#,
            archive_id,
            org_id,
            agent_id,
            filename,
            size_bytes,
            event_count,
            start_date,
            end_date,
            now
        )
        .execute(&mut *tx)
        .await?;

        // DELETE THE ARCHIVED EVENTS — but PRESERVE the most-recent wifi_changed so the
        // device page's "Network Context" card (current network) survives the archive.
        // wifi_changed is edge-triggered (only emitted on a real network change), so if we
        // purged it the card would stay empty until the endpoint next switched networks.
        // The kept event is still copied into the archive; a real network change later
        // emits a fresh wifi_changed that supersedes it. IS DISTINCT FROM keeps the purge
        // working normally when there is no wifi_changed (subquery is NULL).
        sqlx::query!(
            r#"
            DELETE FROM events
            WHERE agent_id = $1 AND organization_id = $2 AND created_at < $3
              AND id IS DISTINCT FROM (
                  SELECT id FROM events
                  WHERE agent_id = $1 AND organization_id = $2
                    AND event_type = 'wifi_changed' AND created_at < $3
                  ORDER BY created_at DESC
                  LIMIT 1
              )
            "#,
            agent_id,
            org_id,
            cutoff
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        info!("Successfully archived {} events for agent {} into {}", event_count, agent_id, filename);

        Ok(Some(Archive {
            id: archive_id,
            organization_id: org_id,
            agent_id: agent_id.to_string(),
            filename,
            size_bytes,
            event_count,
            start_date,
            end_date,
            created_at: now,
        }))
    }

    pub async fn list_archives(&self, agent_id: &str, org_id: Uuid) -> Result<Vec<Archive>> {
        // archives has FORCE RLS — scope the read to the org or it returns nothing.
        let mut tx = self.pool.begin().await?;
        sqlx::query(&format!("SET LOCAL app.current_org_id = '{}'", org_id))
            .execute(&mut *tx)
            .await?;
        let archives = sqlx::query_as!(
            Archive,
            r#"
            SELECT * FROM archives
            WHERE agent_id = $1 AND organization_id = $2
            ORDER BY created_at DESC
            "#,
            agent_id,
            org_id
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(archives)
    }
}
