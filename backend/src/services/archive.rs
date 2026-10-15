use crate::db::models::{Event, Archive};
use sqlx::{PgPool, Postgres, Transaction, Row};
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
    /// By default (auto sweep), it only takes events older than 5 days.
    /// If 'include_recent' is true (manual request), it takes everything.
    /// Cutoff bumped from 7 → 5 days to match the new sweep cadence
    /// (main.rs::ARCHIVE_CUTOFF_DAYS = 5) so an auto-eligible agent
    /// actually has events to write when the 5-day gate opens.
    pub async fn archive_agent_telemetry(&self, agent_id: &str, org_id: Uuid, include_recent: bool) -> Result<Option<Archive>> {
        let now = Utc::now();
        // (b) Non-destructive snapshot model: archive the RECENT window as a COPY; a
        // separate cleanup_old_events sweep handles purging. The scheduled sweep
        // snapshots the last 5 days; a manual request snapshots everything still
        // retained (~7 days) for a complete on-demand bundle.
        let window_days: i64 = if include_recent { 7 } else { 5 };
        let window_start = now - Duration::days(window_days);

        // All events/archives queries run inside ONE org-scoped transaction. The
        // events/archives tables have FORCE row-level security (migration 014); without
        // SET LOCAL app.current_org_id the policies are fail-closed and every SELECT/
        // INSERT/DELETE here silently affects nothing. One tx also closes the gap
        // between reading the events and purging them.
        let mut tx = self.pool.begin().await?;
        sqlx::query(&format!("SET LOCAL app.current_org_id = '{}'", org_id))
            .execute(&mut *tx)
            .await?;

        // 1. Fetch events in the snapshot window — BOUNDED for memory safety. The cap is
        // well above a realistic throttled 5-7 day window so the full window is captured
        // (a busy box was hitting the old 20k cap, truncating its archive — and because
        // model-b purges by time, truncated events would be lost unarchived). The sweep
        // archives one agent at a time, so even the worst case is a bounded, transient
        // allocation. This is a COPY — nothing is deleted here; cleanup_old_events
        // handles retention separately.
        const ARCHIVE_BATCH_LIMIT: i64 = 100_000;
        let mut events = sqlx::query_as!(
            Event,
            r#"
            SELECT * FROM events
            WHERE agent_id = $1 AND organization_id = $2 AND created_at >= $3
            ORDER BY created_at DESC
            LIMIT $4
            "#,
            agent_id,
            org_id,
            window_start,
            ARCHIVE_BATCH_LIMIT
        )
        .fetch_all(&mut *tx)
        .await?;
        // Fetched newest-first to respect the cap; reports/JSON read best oldest-first.
        events.reverse();

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

        // Diagnostic: how many screenshot events are we about to try to
        // embed, and how many of those actually have a file on disk right
        // now? Any gap between the two = the file-cleanup sweep purged
        // the blob before the archive could bundle it (the "no
        // screenshots in the archive" bug operators reported). Log both
        // counts up-front so the mystery becomes visible per archive.
        let (ss_total, ss_on_disk) = {
            use std::collections::HashSet;
            let ss_events: Vec<&crate::db::models::Event> = events
                .iter()
                .filter(|e| e.event_type.eq_ignore_ascii_case("screenshot_captured"))
                .collect();
            let want: HashSet<String> = ss_events
                .iter()
                .filter_map(|e| {
                    e.metadata
                        .as_object()
                        .and_then(|m| m.get("file_id"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect();
            let mut on_disk = 0usize;
            if let Ok(entries) = fs::read_dir(&self.file_storage_dir) {
                for e in entries.flatten() {
                    if let Some(stem) = e.path().file_stem().and_then(|s| s.to_str()) {
                        if want.contains(stem) {
                            on_disk += 1;
                        }
                    }
                }
            }
            (ss_events.len(), on_disk)
        };
        if ss_total > 0 {
            info!(
                "Archive {}: {} screenshot event(s), {} file(s) present on disk, window_start={} limit={}",
                agent_id, ss_total, ss_on_disk, window_start, self.max_screenshots,
            );
            if ss_on_disk < ss_total {
                warn!(
                    "Archive {}: {} screenshot file(s) MISSING from disk (purged before archive?); \
                     the HTML report will render 'not found on disk' placeholders for them",
                    agent_id, ss_total - ss_on_disk
                );
            }
        }

        // Critical (OCR-flagged) screenshots for this agent — queried ONCE and used
        // twice: (1) the HTML report embeds only these inline, and (2) they're bundled
        // as real image files under critical_screenshots/. Embedding only the flagged
        // shots (instead of hundreds of base64 images) is what keeps archiving fast;
        // every screenshot still lives in the files store + events.json regardless.
        // Non-macro query: is_critical / ocr_matches / duplicate_of_file_id come from
        // migrations that run at startup, so we don't compile-check them here.
        // Scoped to the SAME window as the archived events (created_at >= window_start)
        // so the bundled critical images line up with the telemetry in this archive,
        // not the agent's entire on-disk history.
        const CRITICAL_BUNDLE_LIMIT: i64 = 500;
        let critical_rows = sqlx::query(
            r#"
            SELECT file_id, file_name, file_size, ocr_matches, created_at
            FROM files
            WHERE agent_id = $1 AND organization_id = $2
              AND is_critical = TRUE
              AND deleted_at IS NULL
              AND duplicate_of_file_id IS NULL
              AND created_at >= $3
            ORDER BY created_at DESC
            LIMIT $4
            "#,
        )
        .bind(agent_id)
        .bind(org_id)
        .bind(window_start)
        .bind(CRITICAL_BUNDLE_LIMIT)
        .fetch_all(&mut *tx)
        .await
        .unwrap_or_else(|e| {
            warn!("Archive {}: critical-items query failed: {} — none embedded/bundled", agent_id, e);
            Vec::new()
        });
        let critical_ids: std::collections::HashSet<String> =
            critical_rows.iter().map(|r| r.get::<String, _>("file_id")).collect();

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
            &critical_ids,
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

        // 3b. Bundle the CRITICAL screenshots (queried above, reused here) as real
        // image files under critical_screenshots/, plus a critical_items.json manifest.
        // The archive is the permanent record, whereas screenshot blobs on disk are
        // purged after FILE_RETENTION_DAYS — so this preserves the flagged evidence.
        if !critical_rows.is_empty() {
            // One directory scan → stem (file_id) to on-disk path. Blobs live at
            // {file_id}.{ext} (see cleanup_old_files), so the stem is the file_id.
            let mut on_disk: std::collections::HashMap<String, PathBuf> = std::collections::HashMap::new();
            if let Ok(entries) = fs::read_dir(&self.file_storage_dir) {
                for e in entries.flatten() {
                    let p = e.path();
                    if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                        on_disk.insert(stem.to_string(), p);
                    }
                }
            }

            let mut manifest: Vec<serde_json::Value> = Vec::new();
            let mut embedded = 0usize;
            for row in &critical_rows {
                let file_id: String = row.get("file_id");
                let file_name: String = row.get("file_name");
                let file_size: i64 = row.get("file_size");
                let matches: Vec<String> = row.try_get("ocr_matches").unwrap_or_default();
                let created_at: DateTime<Utc> = row.get("created_at");

                // null bundled_as => the blob was already purged from disk before this
                // archive ran; the manifest still records that the item existed + why.
                let mut bundled_as: Option<String> = None;
                if let Some(path) = on_disk.get(&file_id) {
                    if let Ok(bytes) = fs::read(path) {
                        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("bin");
                        let entry = format!("critical_screenshots/{}.{}", file_id, ext);
                        if zip.start_file(&entry, options).is_ok() && zip.write_all(&bytes).is_ok() {
                            bundled_as = Some(entry);
                            embedded += 1;
                        }
                    }
                }

                manifest.push(serde_json::json!({
                    "file_id": file_id,
                    "file_name": file_name,
                    "file_size": file_size,
                    "created_at": created_at,
                    "ocr_matches": matches,
                    "bundled_as": bundled_as,
                }));
            }

            if let Ok(manifest_json) = serde_json::to_string_pretty(&manifest) {
                if zip.start_file("critical_items.json", options).is_ok() {
                    let _ = zip.write_all(manifest_json.as_bytes());
                }
            }
            info!(
                "Archive {}: bundled {}/{} critical screenshot(s) into the zip",
                agent_id, embedded, critical_rows.len()
            );
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

        // (b) Non-destructive: events are NOT deleted here — the archive is a COPY.
        // Retention is handled separately by cleanup_old_events (purges events older
        // than EVENT_RETENTION_DAYS, a safe margin beyond this snapshot window), so the
        // live dashboard keeps its recent data and nothing is purged before it's archived.

        // Stamp the snapshot time so the dashboard "Last archive" cell + the per-agent
        // 5-day cadence gate work. This is the one and only writer of last_archived_at.
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

    /// Retention purge for the `events` table, decoupled from archiving (model b).
    /// Deletes events older than `max_age_days` (by server receive-time), keeping the
    /// live table bounded independently of whether archiving succeeds. `max_age_days`
    /// MUST exceed the archive snapshot window so nothing is purged before it has been
    /// snapshotted. The most-recent `wifi_changed` per agent is preserved regardless of
    /// age so the device page's "Network Context" card survives. Runs BYPASS because the
    /// events table has FORCE RLS; bounded by a statement_timeout so a large first-run
    /// purge can't hold a connection long enough to starve the pool.
    pub async fn cleanup_old_events(&self, max_age_days: i64) -> Result<u64> {
        let cutoff = Utc::now() - Duration::days(max_age_days);
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET LOCAL app.current_org_id = 'BYPASS'")
            .execute(&mut *tx)
            .await?;
        sqlx::query("SET LOCAL statement_timeout = '30s'")
            .execute(&mut *tx)
            .await?;
        let res = sqlx::query(
            r#"
            DELETE FROM events
            WHERE created_at < $1
              AND id NOT IN (
                  SELECT DISTINCT ON (agent_id) id FROM events
                  WHERE event_type = 'wifi_changed'
                  ORDER BY agent_id, created_at DESC
              )
            "#,
        )
        .bind(cutoff)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        let n = res.rows_affected();
        if n > 0 {
            info!("Event retention: purged {} events older than {} days", n, max_age_days);
        }
        Ok(n)
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
