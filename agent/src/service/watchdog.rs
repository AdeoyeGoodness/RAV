//! Endpoint-side watchdog.
//!
//! Invoked as `RavMonitor.exe --watchdog` by a Windows Scheduled Task
//! installed by the MSI. Runs every few minutes under LocalSystem,
//! INDEPENDENTLY of the main monitoring service — so it keeps reporting
//! even when the main service is stopped, killed, or removed. This is what
//! lets the backend tell a killed/crashed agent apart from a clean uninstall
//! apart from a machine that's simply turned off.
//!
//! What it reports per run (POST /api/v1/agents/watchdog):
//!   - service_state:    Running | Stopped | NotInstalled | Unknown
//!   - binary_present:   does the agent exe still exist on disk?
//!   - watchdog_version: this build's CARGO_PKG_VERSION
//!
//! Defense in depth: if it sees the service stopped but the binary present,
//! it tries to start the service before reporting (free self-healing). The
//! report still goes out either way so the backend records the incident.

use anyhow::{Context, Result};
use std::path::Path;
use std::time::Duration;
use tracing::{info, warn};

use crate::config::Config;

// MUST match the ServiceInstall Name in agent-wix/Product.wxs and the runtime
// SERVICE_NAME in service/windows.rs. This internal SCM key is kept stable
// ("AssetTelemetryService") across product renames for upgrade continuity.
const SERVICE_NAME: &str = "AssetTelemetryService";

/// Paths the MSI may have installed the agent to. Keep this in lockstep with
/// Product.wxs's INSTALLFOLDER Name + the [[bin]] name in agent/Cargo.toml.
/// Both the NEW ("RAV Monitoring Agent" / RavMonitor.exe) and the previous
/// ("Asset Telemetry" / AssetTelemetry.exe) locations are listed so a watchdog
/// run during a rename upgrade still finds the binary. Both Program Files
/// variants are checked because per-machine MSIs can land on either.
const INSTALL_PATH_CANDIDATES: &[&str] = &[
    "C:\\Program Files\\RAV Monitoring Agent\\RavMonitor.exe",
    "C:\\Program Files (x86)\\RAV Monitoring Agent\\RavMonitor.exe",
    "C:\\Program Files\\Asset Telemetry\\AssetTelemetry.exe",
    "C:\\Program Files (x86)\\Asset Telemetry\\AssetTelemetry.exe",
];

pub async fn run_watchdog_mode() -> Result<()> {
    let config = Config::load().context("watchdog: loading agent config")?;

    let agent_id = config
        .agent
        .agent_id
        .clone()
        .context("watchdog: agent not enrolled (no agent_id in config) — nothing to report")?;
    let org_id = config
        .agent
        .organization_id
        .clone()
        .context("watchdog: agent not enrolled (no organization_id in config)")?;

    let (service_state, binary_present, attempted_restart) = check_service_status();

    info!(
        "Watchdog: service={} binary_present={} attempted_restart={}",
        service_state, binary_present, attempted_restart
    );

    post_report(
        &config.backend.url,
        &org_id,
        &agent_id,
        &service_state,
        binary_present,
    )
    .await
    .context("watchdog: posting report to backend")?;

    Ok(())
}

#[cfg(windows)]
fn check_service_status() -> (String, bool, bool) {
    use windows_service::service::{ServiceAccess, ServiceState};
    use windows_service::service_manager::{ServiceManager, ServiceManagerAccess};

    let binary_present = INSTALL_PATH_CANDIDATES.iter().any(|p| Path::new(p).exists());

    let scm = match ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT) {
        Ok(s) => s,
        Err(e) => {
            warn!("Watchdog: cannot open SCM: {}", e);
            return ("Unknown".to_string(), binary_present, false);
        }
    };

    let svc = match scm.open_service(
        SERVICE_NAME,
        ServiceAccess::QUERY_STATUS | ServiceAccess::START,
    ) {
        Ok(s) => s,
        Err(_) => {
            // Service doesn't exist or this account can't see it. From a
            // monitoring standpoint that's "NotInstalled" — combined with
            // binary_present the backend can call it "removed" vs "tampered".
            return ("NotInstalled".to_string(), binary_present, false);
        }
    };

    let status = match svc.query_status() {
        Ok(s) => s,
        Err(_) => return ("Unknown".to_string(), binary_present, false),
    };

    // Self-heal: if the service is cleanly Stopped and the binary is still on
    // disk, try to bring it back, then CONFIRM it actually reached Running
    // before reporting. Transitional states (StartPending / StopPending) are
    // left alone so we don't issue a second start while one is already in
    // progress — we just report what we see. The backend gets the report
    // either way so the stop is logged.
    let mut attempted_restart = false;
    let mut final_state = status.current_state;

    if status.current_state == ServiceState::Stopped && binary_present {
        match svc.start::<&str>(&[]) {
            Ok(()) => {
                attempted_restart = true;
                info!("Watchdog: issued start for {}, confirming it reaches Running...", SERVICE_NAME);
                // Poll up to ~15s for the service to actually come up.
                for _ in 0..15 {
                    std::thread::sleep(Duration::from_secs(1));
                    match svc.query_status() {
                        Ok(s) => {
                            final_state = s.current_state;
                            if s.current_state == ServiceState::Running {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
                if final_state == ServiceState::Running {
                    info!("Watchdog: {} confirmed Running after restart", SERVICE_NAME);
                } else {
                    warn!(
                        "Watchdog: {} did not reach Running (state={:?}) within 15s of start",
                        SERVICE_NAME, final_state
                    );
                }
            }
            Err(e) => {
                warn!("Watchdog: tried to start {} but failed: {}", SERVICE_NAME, e);
            }
        }
    }

    let final_state_str = match final_state {
        ServiceState::Running => "Running",
        ServiceState::Stopped => "Stopped",
        ServiceState::StartPending => "StartPending",
        ServiceState::StopPending => "StopPending",
        ServiceState::Paused => "Paused",
        ServiceState::PausePending => "PausePending",
        ServiceState::ContinuePending => "ContinuePending",
    }
    .to_string();

    (final_state_str, binary_present, attempted_restart)
}

#[cfg(not(windows))]
fn check_service_status() -> (String, bool, bool) {
    // Not implemented on non-Windows; the MSI/scheduled task is Windows-only.
    ("Unknown".to_string(), false, false)
}

async fn post_report(
    backend_url: &str,
    org_id: &str,
    agent_id: &str,
    service_state: &str,
    binary_present: bool,
) -> Result<()> {
    let url = format!(
        "{}/api/v1/agents/watchdog",
        backend_url.trim_end_matches('/')
    );

    let hostname = hostname::get()
        .ok()
        .map(|h| h.to_string_lossy().to_string());

    let body = serde_json::json!({
        "agent_id": agent_id,
        "hostname": hostname,
        "service_state": service_state,
        "binary_present": binary_present,
        "watchdog_version": env!("CARGO_PKG_VERSION"),
    });

    // Bounded request — never block the scheduled-task slot for long even on
    // a flaky network. A miss this run is fine; the next run repeats.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .context("building watchdog http client")?;

    let resp = client
        .post(&url)
        .header("X-Organization-Id", org_id)
        .json(&body)
        .send()
        .await
        .context("sending watchdog report")?;

    if !resp.status().is_success() {
        anyhow::bail!("watchdog POST returned {}", resp.status());
    }

    Ok(())
}
