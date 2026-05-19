use anyhow::Result;
use std::sync::Arc;
use tracing::{info, error, warn};
use std::future::Future;
use chrono::Utc;
use serde_json::json;

use crate::config::Config;
use crate::encryption;
use crate::sync::{Event, SyncManager};
use crate::monitoring;
use crate::storage;
use tokio::time::Duration;

pub async fn run_agent(mut config: Config, shutdown_signal: impl Future<Output = ()>) -> Result<()> {
    // Ensure HW Fingerprint is valid BEFORE anything else
    let current_fp = config.agent.hardware_fingerprint.clone().unwrap_or_default();
    if config.agent.hardware_fingerprint.is_none() || current_fp == "unknown" || current_fp.starts_with("unknown") || current_fp.is_empty() {
         let fp = generate_hardware_fingerprint();
         info!("Generated Hardware Fingerprint: {}", fp);
         config.agent.hardware_fingerprint = Some(fp);
         if let Err(e) = config.save() {
             error!("Failed to persist fingerprint: {}", e);
         }
    }

    // 4. Initialize Dependency (SyncManager)
    let config_arc = Arc::new(config);
    encryption::initialize(&config_arc)?;
    
    // Self-repair Native Messaging on every service start
    #[cfg(windows)]
    crate::utils::repair_native_messaging_host();
    
    // Init Persistence
    let storage = Arc::new(storage::StorageManager::new(config_arc.agent.data_dir.clone())?);
    
    let sync_manager = Arc::new(SyncManager::new(config_arc.clone(), storage.clone())?);

    info!("Sync manager initialized");

    // =========================================================================
    // TELEMETRY GAP DETECTION (fixes.md §5)
    // Detect if the agent was offline and emit an AGENT_OFFLINE_PERIOD event
    // so investigators know there's a blind spot in the timeline.
    // =========================================================================
    detect_and_emit_offline_gap(&storage, &sync_manager).await;

    // Start monitoring modules
    let monitoring_handle = start_monitoring(config_arc.clone(), sync_manager.clone()).await?;
    info!("Monitoring modules started");

    // Start sync task
    let sync_handle = {
        let sync_manager = sync_manager.clone();
        tokio::spawn(async move {
            sync_manager.run_sync_loop().await;
        })
    };

    info!("RAV Agent running. Waiting for shutdown...");

    // Start periodic state persistence (Item 6.2)
    let sync_p = sync_manager.clone();
    let interval_mins = if config_arc.persistence.save_interval_minutes == 0 { 5 } else { config_arc.persistence.save_interval_minutes };
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(interval_mins * 60));
        loop {
            interval.tick().await;
            if let Err(e) = sync_p.persist_state().await {
                error!("State persistence error: {}", e);
            }
        }
    });

    // Periodically update the "last alive" timestamp so gap detection works
    // even if the agent is killed ungracefully (SIGKILL, BSOD, power loss).
    let storage_heartbeat = storage.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(60));
        loop {
            interval.tick().await;
            let _ = storage_heartbeat.save_state(
                "last_alive_at",
                &json!(Utc::now().to_rfc3339()),
            );
        }
    });

    // Wait for shutdown signal
    shutdown_signal.await;
    info!("Shutdown signal received, stopping agent...");

    // =========================================================================
    // GRACEFUL SHUTDOWN: Persist state for next startup's gap detection
    // =========================================================================
    persist_shutdown_state(&storage, &sync_manager).await;

    // Graceful shutdown
    monitoring_handle.abort();
    sync_handle.abort();

    info!("RAV Agent stopped");
    Ok(())
}

/// Detect if the agent was previously running and went offline.
/// If a gap is found, emit an AGENT_OFFLINE_PERIOD event with
/// the duration and any state changes (e.g., WiFi network changed).
async fn detect_and_emit_offline_gap(
    storage: &Arc<storage::StorageManager>,
    sync_manager: &Arc<SyncManager>,
) {
    let now = Utc::now();

    // Try to read the last known alive timestamp.
    // We check both "last_shutdown_at" (graceful) and "last_alive_at" (periodic heartbeat).
    // Use whichever is more recent — covers both graceful shutdown and crashes.
    let last_timestamp = {
        let shutdown_ts = storage.load_state("last_shutdown_at")
            .ok()
            .flatten()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc));

        let alive_ts = storage.load_state("last_alive_at")
            .ok()
            .flatten()
            .and_then(|v| v.as_str().map(|s| s.to_string()))
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(&s).ok())
            .map(|dt| dt.with_timezone(&Utc));

        match (shutdown_ts, alive_ts) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (Some(a), None) => Some(a),
            (None, Some(b)) => Some(b),
            (None, None) => None,
        }
    };

    let last_ts = match last_timestamp {
        Some(ts) => ts,
        None => {
            // First ever run — no previous state to compare against
            info!("Telemetry Gap: No previous shutdown state found (first run or fresh install)");
            return;
        }
    };

    let gap_seconds = (now - last_ts).num_seconds();

    // Only emit a gap event if the agent was offline for more than 2 minutes.
    // Shorter gaps are normal service restarts / reboots.
    if gap_seconds < 120 {
        info!("Telemetry Gap: Agent was offline for {}s (below threshold, not logging)", gap_seconds);
        return;
    }

    // Load the network state that was saved before shutdown
    let state_before = storage.load_state("shutdown_network_state")
        .ok()
        .flatten()
        .unwrap_or(json!({"ssid": "unknown", "bssid": "unknown"}));

    // Get current network state for comparison
    let state_after = get_current_network_state().await;

    let (agent_id, _) = sync_manager.get_identity().await;

    let gap_event = Event {
        event_type: "AGENT_OFFLINE_PERIOD".to_string(),
        timestamp: now,
        agent_id,
        metadata: json!({
            "offline_from": last_ts.to_rfc3339(),
            "offline_to": now.to_rfc3339(),
            "duration_seconds": gap_seconds,
            "state_before_offline": state_before,
            "state_after_restart": state_after,
            "transitions_observed": 0,
            "note": if state_before != state_after {
                "State change detected after restart. Intermediate transitions not observable."
            } else {
                "Agent was offline. No state change detected on restart."
            }
        }),
    };

    info!(
        "Telemetry Gap: Agent was OFFLINE for {} seconds ({} → {}). Emitting gap event.",
        gap_seconds,
        last_ts.format("%Y-%m-%d %H:%M:%S"),
        now.format("%Y-%m-%d %H:%M:%S")
    );

    sync_manager.queue_event(gap_event);
}

/// Save the current timestamp and network state to SQLite before shutting down.
/// The next startup will read this to detect and measure the offline gap.
async fn persist_shutdown_state(
    storage: &Arc<storage::StorageManager>,
    _sync_manager: &Arc<SyncManager>,
) {
    let now = Utc::now();

    // Save shutdown timestamp
    if let Err(e) = storage.save_state("last_shutdown_at", &json!(now.to_rfc3339())) {
        error!("Failed to persist shutdown timestamp: {}", e);
    }

    // Save current network state so we can compare on next startup
    let network_state = get_current_network_state().await;
    if let Err(e) = storage.save_state("shutdown_network_state", &network_state) {
        error!("Failed to persist shutdown network state: {}", e);
    }

    info!("Shutdown state persisted (timestamp + network state)");
}

/// Get the current WiFi/network state for gap event metadata.
async fn get_current_network_state() -> serde_json::Value {
    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("netsh")
            .args(&["wlan", "show", "interfaces"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Ok(output) = output {
            let out_str = String::from_utf8_lossy(&output.stdout);
            let mut ssid = "Disconnected".to_string();
            let mut bssid = "00:00:00:00:00:00".to_string();

            for line in out_str.lines() {
                let line = line.trim();
                if let Some((key, value)) = line.split_once(':') {
                    let key = key.trim();
                    let value = value.trim();
                    match key {
                        "SSID" => ssid = value.to_string(),
                        "BSSID" => bssid = value.to_string(),
                        _ => {}
                    }
                }
            }
            return json!({ "ssid": ssid, "bssid": bssid });
        }
        json!({ "ssid": "unknown", "bssid": "unknown" })
    }

    #[cfg(not(windows))]
    {
        json!({ "ssid": "unknown", "bssid": "unknown" })
    }
}

pub fn generate_agent_id() -> String {
    // Use hostname as base for agent ID
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    
    // Generate a unique ID based on hostname and UUID
    use uuid::Uuid;
    let uuid_short = Uuid::new_v4().to_string().split('-').next().unwrap().to_string();
    format!("{}-{}", hostname, uuid_short)
}

pub fn generate_hardware_fingerprint() -> String {
    use sha2::{Sha256, Digest};
    use std::process::Command;
    
    let mut hasher = Sha256::new();
    
    // Add hostname
    if let Ok(hostname) = std::env::var("COMPUTERNAME") {
        hasher.update(hostname.as_bytes());
    }
    
    // Add username
    if let Ok(username) = std::env::var("USERNAME") {
        hasher.update(username.as_bytes());
    }
    
    // Add system UUID (Windows)
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        if let Ok(output) = Command::new("wmic")
            .args(&["csproduct", "get", "uuid"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if let Ok(uuid_str) = String::from_utf8(output.stdout) {
                // Extract UUID from wmic output
                for line in uuid_str.lines() {
                    let line = line.trim();
                    if !line.is_empty() && line != "UUID" && !line.contains("---") {
                        hasher.update(line.as_bytes());
                        break;
                    }
                }
            }
        }
        
        // Add processor ID
        if let Ok(output) = Command::new("wmic")
            .args(&["cpu", "get", "ProcessorId"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if let Ok(proc_id) = String::from_utf8(output.stdout) {
                for line in proc_id.lines() {
                    let line = line.trim();
                    if !line.is_empty() && line != "ProcessorId" && !line.contains("---") {
                        hasher.update(line.as_bytes());
                        break;
                    }
                }
            }
        }
    }
    
    format!("{:x}", hasher.finalize())
}

async fn start_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<tokio::task::JoinHandle<()>> {
    let handle = tokio::spawn(async move {
        // Start all monitoring modules as separate concurrent tasks with self-healing (Item 8.2)
        
        // 1. USB Monitoring
        let config_usb = config.clone();
        let sync_usb = sync_manager.clone();
        tokio::spawn(async move {
            loop {
                info!("Starting/Restarting USB monitoring...");
                if let Err(e) = monitoring::usb::start_monitoring(config_usb.clone(), sync_usb.clone()).await {
                    error!("USB monitoring module CRASHED: {}. Restarting in 10s...", e);
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });

        // 2. Network Monitoring
        let config_network = config.clone();
        let sync_network = sync_manager.clone();
        tokio::spawn(async move {
            loop {
                info!("Starting/Restarting Network monitoring...");
                if let Err(e) = monitoring::network::start_monitoring(config_network.clone(), sync_network.clone()).await {
                    error!("Network monitoring module CRASHED: {}. Restarting in 10s...", e);
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });

        // 3. Screenshot Monitoring
        let config_screenshots = config.clone();
        let sync_screenshots = sync_manager.clone();
        tokio::spawn(async move {
            loop {
                info!("Starting/Restarting Screenshot monitoring...");
                if let Err(e) = monitoring::screenshots::start_monitoring(config_screenshots.clone(), sync_screenshots.clone()).await {
                    error!("Screenshot monitoring module CRASHED: {}. Restarting in 10s...", e);
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });

        // 5. Process Monitoring
        let config_process = config.clone();
        let sync_process = sync_manager.clone();
        tokio::spawn(async move {
            loop {
                info!("Starting/Restarting Process monitoring...");
                if let Err(e) = monitoring::process::start_monitoring(config_process.clone(), sync_process.clone()).await {
                    error!("Process monitoring module CRASHED: {}. Restarting in 10s...", e);
                }
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });

        // 6. Browser Monitoring (Forensic Scraper)
        let config_browser = config.clone();
        let sync_browser = sync_manager.clone();
        tokio::spawn(async move {
            loop {
                info!("Starting/Restarting Browser history scraper...");
                if let Err(e) = monitoring::browser::start_monitoring(config_browser.clone(), sync_browser.clone()).await {
                    error!("Browser scraper module CRASHED: {}. Restarting in 15s...", e);
                }
                tokio::time::sleep(Duration::from_secs(15)).await;
            }
        });

        // 7. Extension Server (Native Messaging Interface)
        let config_extension = config.clone();
        let sync_extension = sync_manager.clone();
        tokio::spawn(async move {
            loop {
                info!("Starting/Restarting Extension Server...");
                if let Err(e) = monitoring::extension_server::start_extension_server(config_extension.clone(), sync_extension.clone()).await {
                    error!("Extension server CRASHED: {}. Restarting in 15s...", e);
                }
                tokio::time::sleep(Duration::from_secs(15)).await;
            }
        });

        // 5. Resource Watcher (Item 11.2, 11.3, 11.4) + Tamper Detection (5.7)
        let config_res = config.clone();
        let sync_res = sync_manager.clone();
        tokio::spawn(async move {
            use sysinfo::System;
            let mut sys = System::new_all();
            let pid = sysinfo::get_current_pid().ok();
            
            loop {
                tokio::time::sleep(Duration::from_secs(60)).await;
                sys.refresh_all();
                
                // 1. Tamper Check (Item 5.7)
                if let Ok(true) = crate::utils::detect_tampering(&config_res.stealth.service_name) {
                     sync_res.audit_event("CRITICAL: Local service tampering detected! Service entry missing or modified.", "critical").await;
                }

                // 2. Resource Monitoring (Item 11.2)
                if let Some(pid) = pid {
                    sys.refresh_process(pid);
                    if let Some(proc) = sys.process(pid) {
                        let mem_bytes = proc.memory();
                        let mem_mb = mem_bytes / 1024 / 1024;
                        
                        if mem_mb > config_res.performance.max_memory_mb {
                            warn!("Resource Alert: Agent memory usage ({} MB) exceeds limit ({} MB). Throttling activities...", 
                                 mem_mb, config_res.performance.max_memory_mb);
                        }
                    }
                }
            }
        });

        // Keep this task alive (all monitoring tasks run in background)
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
        }
    });

    Ok(handle)
}
