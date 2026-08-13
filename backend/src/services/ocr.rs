//! Screenshot content-scanning pipeline.
//!
//! Every new `files` row lands with `ocr_status = 'pending'`. A background
//! sweep in `main.rs` calls into this service, which:
//!
//!   1. Shells out to the local `tesseract` binary to extract text from the
//!      image on disk (spawn_blocking so the async runtime doesn't stall on
//!      what is, on a full-HD screenshot, a couple-hundred-ms CPU burn).
//!   2. Matches that text against the org's keyword list (globals + per-org
//!      overrides), case-insensitive substring for plain terms, real regex
//!      for `is_regex` rows.
//!   3. Writes back `ocr_status`, `ocr_matches`, `is_critical` on the row.
//!
//! If tesseract isn't installed the sweep marks rows `failed` with an error
//! message and keeps going — never crash the backend over a missing OCR tool.

use anyhow::Result;
use regex::RegexBuilder;
use sqlx::PgPool;
use std::path::{Path, PathBuf};
use std::process::Command;
use tracing::{info, warn};
use uuid::Uuid;

/// One keyword rule from `sensitive_keywords`. Matched against extracted OCR
/// text; `is_regex` distinguishes "plain substring" (fast, common) from a real
/// pattern (slower, for stuff like credit-card / SSN detectors down the line).
#[derive(Debug, Clone)]
pub struct Keyword {
    pub keyword: String,
    pub is_regex: bool,
}

/// One image the background worker just picked up. Holds only what the OCR
/// pass needs to do its job and write results back.
#[derive(Debug, Clone)]
pub struct PendingFile {
    pub id: Uuid,
    pub file_id: String,
    pub file_name: String,
    pub organization_id: Uuid,
}

pub struct OcrService {
    pool: PgPool,
    file_storage_dir: PathBuf,
    /// Tesseract binary path — configurable so admins can point at a build in
    /// a non-standard location. Defaults to `tesseract` on PATH.
    tesseract_bin: String,
    /// How many pending files to grab per sweep. Bounded because OCR is CPU
    /// heavy and we don't want to starve the request-serving threads.
    batch_size: i64,
}

impl OcrService {
    pub fn new(pool: PgPool, file_storage_dir: PathBuf) -> Self {
        Self {
            pool,
            file_storage_dir,
            tesseract_bin: std::env::var("TESSERACT_BIN").unwrap_or_else(|_| "tesseract".into()),
            batch_size: std::env::var("OCR_BATCH_SIZE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
        }
    }

    /// True if the local box actually has a tesseract binary reachable. Cheap
    /// probe so the background worker can log a clear "install tesseract"
    /// message once instead of failing every batch silently.
    pub fn tesseract_available(&self) -> bool {
        Command::new(&self.tesseract_bin)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }

    /// Fetch the effective keyword list for an org: platform-wide defaults
    /// (`organization_id IS NULL`) plus the org's own extras. BYPASS because
    /// the worker sweeps across orgs and we need to see everything.
    async fn load_keywords(&self, org_id: Uuid) -> Result<Vec<Keyword>> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET LOCAL app.current_org_id = 'BYPASS'")
            .execute(&mut *tx)
            .await?;
        let rows = sqlx::query_as::<_, (String, bool)>(
            "SELECT keyword, is_regex
             FROM sensitive_keywords
             WHERE organization_id IS NULL OR organization_id = $1",
        )
        .bind(org_id)
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(rows
            .into_iter()
            .map(|(keyword, is_regex)| Keyword { keyword, is_regex })
            .collect())
    }

    /// Grab the next batch of pending images to scan. Ignores non-image
    /// extensions (marks them `skipped` so we never look at them again).
    ///
    /// `files` has FORCE ROW LEVEL SECURITY from migration 014 — every read
    /// and write here MUST run inside a tx that sets
    /// `app.current_org_id = 'BYPASS'`, otherwise the policy silently filters
    /// every query to zero rows and the worker looks like it's doing nothing.
    pub async fn claim_batch(&self) -> Result<Vec<PendingFile>> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET LOCAL app.current_org_id = 'BYPASS'")
            .execute(&mut *tx)
            .await?;

        // First pass: mark non-image pending rows as skipped so they stop
        // being reconsidered forever. Cheap — the partial index makes the
        // WHERE clause tight.
        let _ = sqlx::query(
            "UPDATE files
             SET ocr_status = 'skipped'
             WHERE ocr_status = 'pending'
               AND lower(file_name) !~ '\\.(png|jpe?g|webp|bmp|tiff?)$'",
        )
        .execute(&mut *tx)
        .await;

        // Second pass: claim up to N image rows.
        let rows = sqlx::query_as::<_, (Uuid, String, String, Uuid)>(
            "SELECT id, file_id, file_name, organization_id
             FROM files
             WHERE ocr_status = 'pending'
             ORDER BY created_at ASC
             LIMIT $1",
        )
        .bind(self.batch_size)
        .fetch_all(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(rows
            .into_iter()
            .map(|(id, file_id, file_name, organization_id)| PendingFile {
                id,
                file_id,
                file_name,
                organization_id,
            })
            .collect())
    }


    /// Resolve the on-disk path for a file row. Blobs live at
    /// `<storage>/<file_id>.<ext>` — the ext is inferred from `file_name`.
    fn blob_path(&self, f: &PendingFile) -> PathBuf {
        let ext = Path::new(&f.file_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");
        self.file_storage_dir.join(format!("{}.{}", f.file_id, ext))
    }

    /// Given raw OCR text and a keyword list, return the list of keywords that
    /// hit. Case-insensitive substring for plain terms, real regex compile for
    /// `is_regex` rows (regex compile failures are logged and skipped).
    fn find_matches(text: &str, keywords: &[Keyword]) -> Vec<String> {
        let lower = text.to_lowercase();
        let mut hits: Vec<String> = Vec::new();
        for kw in keywords {
            if kw.is_regex {
                match RegexBuilder::new(&kw.keyword).case_insensitive(true).build() {
                    Ok(re) if re.is_match(text) => hits.push(kw.keyword.clone()),
                    Ok(_) => {}
                    Err(e) => warn!("OCR: bad regex keyword {:?}: {}", kw.keyword, e),
                }
            } else if lower.contains(&kw.keyword.to_lowercase()) {
                hits.push(kw.keyword.clone());
            }
        }
        hits.sort();
        hits.dedup();
        hits
    }

    /// Full pipeline for one file: OCR → match → write results back.
    pub async fn process_one(&self, file: PendingFile) -> Result<()> {
        let keywords = self.load_keywords(file.organization_id).await?;
        let path = self.blob_path(&file);

        // If the blob is missing (already deleted by a sweep), record that
        // and move on so we don't wedge on the same row every batch.
        // BYPASS tx because `files` has FORCE RLS (migration 014).
        if !path.exists() {
            let mut tx = self.pool.begin().await?;
            let _ = sqlx::query("SET LOCAL app.current_org_id = 'BYPASS'")
                .execute(&mut *tx).await;
            let _ = sqlx::query(
                "UPDATE files SET ocr_status = 'failed', ocr_error = 'blob missing', ocr_processed_at = NOW() WHERE id = $1",
            )
            .bind(file.id)
            .execute(&mut *tx)
            .await;
            let _ = tx.commit().await;
            return Ok(());
        }

        // Move the tesseract shell-out onto the blocking pool so it can't
        // stall the request handlers.
        let bin = self.tesseract_bin.clone();
        let path_owned = path.clone();
        let text_result = tokio::task::spawn_blocking(move || {
            let output = Command::new(&bin)
                .arg(&path_owned)
                .arg("-")
                .arg("-l")
                .arg("eng")
                .output();
            match output {
                Ok(o) if o.status.success() => Ok(String::from_utf8_lossy(&o.stdout).to_string()),
                Ok(o) => Err(format!(
                    "tesseract exited {}: {}",
                    o.status,
                    String::from_utf8_lossy(&o.stderr).trim()
                )),
                Err(e) => Err(format!("failed to spawn tesseract: {}", e)),
            }
        })
        .await
        .unwrap_or_else(|e| Err(format!("blocking join error: {}", e)));

        // Any write to `files` must run inside a BYPASS-RLS tx.
        let mut tx = self.pool.begin().await?;
        sqlx::query("SET LOCAL app.current_org_id = 'BYPASS'")
            .execute(&mut *tx)
            .await?;

        match text_result {
            Ok(text) => {
                let matches = Self::find_matches(&text, &keywords);
                let is_critical = !matches.is_empty();
                sqlx::query(
                    "UPDATE files
                     SET ocr_status = 'done',
                         ocr_matches = $1,
                         is_critical = $2,
                         ocr_processed_at = NOW(),
                         ocr_error = NULL
                     WHERE id = $3",
                )
                .bind(&matches)
                .bind(is_critical)
                .bind(file.id)
                .execute(&mut *tx)
                .await?;
                if is_critical {
                    info!("OCR: {} flagged critical ({} hits)", file.file_id, matches.len());
                }
            }
            Err(err) => {
                warn!("OCR: {} failed: {}", file.file_id, err);
                let _ = sqlx::query(
                    "UPDATE files
                     SET ocr_status = 'failed',
                         ocr_error = $1,
                         ocr_processed_at = NOW()
                     WHERE id = $2",
                )
                .bind(err)
                .bind(file.id)
                .execute(&mut *tx)
                .await;
            }
        }

        tx.commit().await?;
        Ok(())
    }
}
