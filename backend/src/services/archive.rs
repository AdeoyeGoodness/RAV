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
        let cutoff = if include_recent {
            now
        } else {
            now - Duration::days(5)
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

        // 1. Fetch events for the window — BOUNDED. Without a cap, an agent
        // with a huge backlog (the never-purged events table) would try to
        // load millions of rows into memory at once and the archive would
        // hang / OOM — which is exactly why archiving had never succeeded.
        // We take the OLDEST batch; if a full batch comes back there's more
        // to do and the agent stays eligible for the next sweep pass.
        const ARCHIVE_BATCH_LIMIT: i64 = 20_000;
        let events = sqlx::query_as!(
            Event,
            r#"
            SELECT * FROM events
            WHERE agent_id = $1 AND organization_id = $2 AND created_at < $3
            ORDER BY created_at ASC
            LIMIT $4
            "#,
            agent_id,
            org_id,
            cutoff,
            ARCHIVE_BATCH_LIMIT
        )
        .fetch_all(&mut *tx)
        .await?;

        if events.is_empty() {
            return Ok(None);
        }

        // Exact set we archived — delete only these, so a tie at the batch
        // boundary can never purge an event we didn't bundle. caught_up is
        // false when the batch was full (more backlog remains).
        let archived_ids: Vec<Uuid> = events.iter().map(|e| e.id).collect();
        let caught_up = (events.len() as i64) < ARCHIVE_BATCH_LIMIT;

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
                "Archive {}: {} screenshot event(s), {} file(s) present on disk, cutoff={} limit={}",
                agent_id, ss_total, ss_on_disk, cutoff, self.max_screenshots,
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
        // Scoped to the SAME window as the archived events (created_at < cutoff) so the
        // bundled critical images line up with the telemetry in this archive — not the
        // agent's entire on-disk history. For a manual archive cutoff = now (all current
        // critical items, bounded by the 7-day file retention); for the weekly sweep
        // cutoff = now - 5 days (the aged-out window being archived).
        const CRITICAL_BUNDLE_LIMIT: i64 = 500;
        let critical_rows = sqlx::query(
            r#"
            SELECT file_id, file_name, file_size, ocr_matches, created_at
            FROM files
            WHERE agent_id = $1 AND organization_id = $2
              AND is_critical = TRUE
              AND deleted_at IS NULL
              AND duplicate_of_file_id IS NULL
              AND created_at < $3
            ORDER BY created_at DESC
            LIMIT $4
            "#,
        )
        .bind(agent_id)
        .bind(org_id)
        .bind(cutoff)
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
            WHERE id = ANY($1)
              AND id IS DISTINCT FROM (
                  SELECT id FROM events
                  WHERE agent_id = $2 AND organization_id = $3
                    AND event_type = 'wifi_changed' AND created_at < $4
                  ORDER BY created_at DESC
                  LIMIT 1
              )
            "#,
            &archived_ids,
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
        // Only stamp last_archived_at once the agent is fully caught up (the
        // batch wasn't full). While backlog remains we deliberately leave it
        // unset so the 5-day per-agent gate doesn't lock the agent out before
        // the rest of its backlog is archived on subsequent sweep passes.
        if caught_up {
            sqlx::query(
                "UPDATE agents SET last_archived_at = $1 \
                 WHERE agent_id = $2 AND organization_id = $3",
            )
            .bind(now)
            .bind(agent_id)
            .bind(org_id)
            .execute(&mut *tx)
            .await?;
        }

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
