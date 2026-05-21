//! Agent self-update (MSI-based).
//!
//! The backend advertises the latest published agent in its heartbeat response
//! (`update: { version, sha256, url }`). If that version is newer than ours, we download the
//! MSI, verify its SHA-256, and hand it to the Windows Installer:
//!
//!   msiexec /i RAVAgent.msi /qn /norestart REBOOT=ReallySuppress WIXUI_EXITDIALOGOPTIONALCHECKBOX=0
//!
//! Windows Installer (a separate service, `msiserver`) then stops the RAVAgent service, replaces
//! every installed file via the WiX MajorUpgrade, and restarts the service — fully unattended,
//! no reboot, no prompt. Because msiexec runs out-of-process, it survives our service being
//! stopped mid-update.
//!
//! SECURITY: over plain HTTP this is effectively SYSTEM-level remote code execution sourced from
//! the backend. The SHA-256 check only guards against corruption (the hash arrives over the same
//! channel). Real hardening = TLS + an Authenticode-signed MSI; tracked separately.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Deserialize;
use tracing::{error, info, warn};

use crate::config::Config;

/// The `update` object from the heartbeat response.
#[derive(Debug, Clone, Deserialize)]
pub struct UpdateInfo {
    pub version: String,
    #[serde(default)]
    pub sha256: Option<String>,
    /// Either an absolute URL or a path to join onto `backend.url` (e.g. `/api/v1/agent/download`).
    pub url: String,
}

/// Only one update may run at a time; once we launch msiexec the process is about to be replaced.
static UPDATE_RUNNING: AtomicBool = AtomicBool::new(false);
/// Remember the last version we tried, so a publish mistake (e.g. MSI ProductVersion not bumped,
/// so the install no-ops and we keep our old version) doesn't re-download every heartbeat.
static LAST_ATTEMPT: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();
const RETRY_COOLDOWN: Duration = Duration::from_secs(30 * 60);

/// Remove a stale downloaded installer from a previous update cycle. Call once on startup.
pub fn cleanup_stale(config: &Config) {
    let dir = update_dir(config);
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
}

fn update_dir(config: &Config) -> std::path::PathBuf {
    std::path::Path::new(&config.agent.data_dir).join("update")
}

/// Compare the advertised version with ours and, if newer, download + apply it. Never returns an
/// error — auto-update problems must not affect the heartbeat. A successful apply does not return
/// (the service is stopped by the installer shortly after).
pub async fn maybe_apply(config: &Config, info: &UpdateInfo) {
    let current = env!("CARGO_PKG_VERSION");

    let (latest, current_v) = match (
        semver::Version::parse(info.version.trim()),
        semver::Version::parse(current),
    ) {
        (Ok(l), Ok(c)) => (l, c),
        _ => {
            warn!("Auto-update: unparseable version (advertised='{}', current='{}')", info.version, current);
            return;
        }
    };

    if latest <= current_v {
        return; // up to date (or server is behind) — nothing to do
    }

    if already_attempted_recently(&info.version) {
        return; // cooling down after a recent attempt at this same version
    }

    // Claim the single-update slot.
    if UPDATE_RUNNING.swap(true, Ordering::SeqCst) {
        return; // an update is already in flight
    }
    record_attempt(&info.version);

    info!("Auto-update: {} -> {} available; downloading installer", current, latest);
    if let Err(e) = download_and_launch(config, info).await {
        error!("Auto-update failed: {:#}", e);
        // Allow a retry on a later heartbeat (after the cooldown).
        UPDATE_RUNNING.store(false, Ordering::SeqCst);
    }
    // On success we deliberately leave UPDATE_RUNNING set; msiexec will stop this process.
}

async fn download_and_launch(config: &Config, info: &UpdateInfo) -> anyhow::Result<()> {
    use anyhow::Context;

    let url = if info.url.starts_with("http://") || info.url.starts_with("https://") {
        info.url.clone()
    } else {
        format!("{}{}", config.backend.url.trim_end_matches('/'), info.url)
    };

    // Dedicated client with a generous timeout for the (multi-MB) installer download.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .context("building update http client")?;

    let mut request = client.get(&url);
    if let Some(api_key) = &config.backend.api_key {
        request = request.header("X-API-Key", api_key);
    }
    let resp = request.send().await.context("downloading installer")?;
    if !resp.status().is_success() {
        anyhow::bail!("installer download returned {}", resp.status());
    }
    let bytes = resp.bytes().await.context("reading installer body")?;

    // Integrity check.
    match &info.sha256 {
        Some(expected) => {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let got = format!("{:x}", hasher.finalize());
            if !got.eq_ignore_ascii_case(expected.trim()) {
                anyhow::bail!("installer sha256 mismatch (expected {}, got {})", expected, got);
            }
            info!("Auto-update: sha256 verified ({} bytes)", bytes.len());
        }
        None => warn!("Auto-update: no sha256 in manifest — skipping integrity check ({} bytes)", bytes.len()),
    }

    // Persist to a writable, predictable location.
    let dir = update_dir(config);
    std::fs::create_dir_all(&dir).context("creating update dir")?;
    let msi_path = dir.join("RAVAgent.msi");
    std::fs::write(&msi_path, &bytes).context("writing installer to disk")?;

    launch_installer(&msi_path)
}

#[cfg(windows)]
fn launch_installer(msi_path: &std::path::Path) -> anyhow::Result<()> {
    use anyhow::Context;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    const DETACHED_PROCESS: u32 = 0x00000008;

    let msi = msi_path.to_str().context("installer path not valid UTF-8")?;

    // /qn = silent, no UI/prompts. /norestart + REBOOT=ReallySuppress = never reboot the machine.
    // WIXUI_EXITDIALOGOPTIONALCHECKBOX=0 stops the WiX ScheduleReboot from firing in silent mode.
    // Detached so stopping the RAVAgent service mid-upgrade can't take msiexec down with it.
    std::process::Command::new("msiexec")
        .args([
            "/i",
            msi,
            "/qn",
            "/norestart",
            "REBOOT=ReallySuppress",
            "WIXUI_EXITDIALOGOPTIONALCHECKBOX=0",
        ])
        .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
        .spawn()
        .context("spawning msiexec")?;

    info!("Auto-update: msiexec launched; installer will stop, replace, and restart the service");
    Ok(())
}

#[cfg(not(windows))]
fn launch_installer(_msi_path: &std::path::Path) -> anyhow::Result<()> {
    warn!("Auto-update: MSI install is only supported on Windows; skipping");
    Ok(())
}

fn already_attempted_recently(version: &str) -> bool {
    let guard = LAST_ATTEMPT.get_or_init(|| Mutex::new(None)).lock().unwrap();
    matches!(&*guard, Some((v, t)) if v == version && t.elapsed() < RETRY_COOLDOWN)
}

fn record_attempt(version: &str) {
    let mut guard = LAST_ATTEMPT.get_or_init(|| Mutex::new(None)).lock().unwrap();
    *guard = Some((version.to_string(), Instant::now()));
}
