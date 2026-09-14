use crate::db::models::{Event, Archive};
use sqlx::{PgPool, Postgres, Transaction};
use anyhow::{Result, Context};
use chrono::{DateTime, Utc, Duration};
use std::fs;
use std::path::{Path, PathBuf};
use zip::write::FileOptions;
use std::io::Write;
use uuid::Uuid;
use std::collections::HashSet;
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
        // Use the actual event `timestamp` (when the event happened on the endpoint), NOT
        // `created_at` (when the backend received it). Agents are store-and-forward, so an
        // offline box that comes back online and flushes a backlog gives a tight `created_at`
        // window but a much wider true coverage window. Using timestamp here makes the
        // 'Telemetry Range' the dashboard shows actually reflect when these events happened.
        let start_date = events.iter().map(|e| e.timestamp).min().unwrap();
        let end_date = events.iter().map(|e| e.timestamp).max().unwrap();

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

        // Organization name for the report header (organizations table has no RLS).
        let org_name = sqlx::query!("SELECT name FROM organizations WHERE id = $1", org_id)
            .fetch_optional(&mut *tx)
            .await?
            .map(|r| r.name)
            .unwrap_or_default();

        // Human-readable HTML reports — one per section. A failure here must NOT abort
        // archiving/purge; we still ship the JSON-only zip and proceed.
        match crate::services::report::generate_section_reports(
            agent_id,
            agent_id,
            &org_name,
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

        // Stamp the agent row with the archive time so the dashboard can render
        // "Last archive: 3d" without having to join to archives from the hot
        // agents-list path. `agents.last_archived_at` was declared on the model
        // back in migration 011 but was never written; wiring it here is the
        // one and only writer.
        sqlx::query(
            "UPDATE agents SET last_archived_at = $1 \
             WHERE agent_id = $2 AND organization_id = $3",
        )
        .bind(now)
        .bind(agent_id)
        .bind(org_id)
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

    /// Delete archives older than `max_age_days`. Removes both the on-disk ZIP and the
    /// `archives` row. The dashboard's vault page tells admins archives only live for 2 days;
    /// this is what makes that promise true. Cross-org sweep (the archives table doesn't have
    /// RLS, so a plain query is fine). Errors deleting a single file are logged but don't
    /// abort the rest of the cleanup.
    pub async fn cleanup_old_archives(&self, max_age_days: i64) -> Result<usize> {
        let cutoff = Utc::now() - Duration::days(max_age_days);

        let stale = sqlx::query!(
            r#"SELECT id, filename FROM archives WHERE created_at < $1"#,
            cutoff
        )
        .fetch_all(&self.pool)
        .await?;

        let count = stale.len();

        for row in &stale {
            let file_path = self.storage_dir.join(&row.filename);
            if file_path.exists() {
                if let Err(e) = fs::remove_file(&file_path) {
                    warn!("Archive cleanup: failed to delete {}: {}", file_path.display(), e);
                }
            }
        }

        sqlx::query!(
            r#"DELETE FROM archives WHERE created_at < $1"#,
            cutoff
        )
        .execute(&self.pool)
        .await?;

        if count > 0 {
            info!("Archive cleanup: purged {} archives older than {} days", count, max_age_days);
        }
        Ok(count)
    }

    /// Delete uploaded blobs (screenshots, USB payloads) older than `max_age_days`.
    /// Events older than 7 days are already archived+purged from the `events` table by
    /// `archive_agent_telemetry`, so the referencing rows are gone and the blobs on disk
    /// are effectively orphaned. Without this sweep `storage/files/` grows unbounded and
    /// the endpoint detail page's screenshot list gets slower every week.
    /// Cross-org sweep (files table has no RLS). One directory scan, O(files_on_disk).
    pub async fn cleanup_old_files(&self, max_age_days: i64) -> Result<usize> {
        let cutoff = Utc::now() - Duration::days(max_age_days);

        let stale = sqlx::query!(
            r#"SELECT file_id FROM files WHERE created_at < $1"#,
            cutoff
        )
        .fetch_all(&self.pool)
        .await?;

        let count = stale.len();
        if count == 0 {
            return Ok(0);
        }

        let stale_ids: HashSet<String> = stale.iter().map(|r| r.file_id.clone()).collect();

        // Single dir scan: blobs live at {file_id}.{ext}. Match on the stem, delete on hit.
        // Errors on individual files are logged but don't abort the sweep.
        if let Ok(entries) = fs::read_dir(&self.file_storage_dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    let stem = match name.rfind('.') {
                        Some(dot) => &name[..dot],
                        None => name,
                    };
                    if stale_ids.contains(stem) {
                        if let Err(e) = fs::remove_file(entry.path()) {
                            warn!("File cleanup: failed to delete {}: {}", entry.path().display(), e);
                        }
                    }
                }
            }
        } else {
            warn!("File cleanup: could not read {}", self.file_storage_dir.display());
        }

        sqlx::query!(r#"DELETE FROM files WHERE created_at < $1"#, cutoff)
            .execute(&self.pool)
            .await?;

        info!("File cleanup: purged {} files older than {} days", count, max_age_days);
        Ok(count)
    }
}
