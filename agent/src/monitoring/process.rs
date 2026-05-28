use anyhow::Result;
use chrono::Utc;
use serde_json::json;
use std::sync::Arc;
use std::collections::HashMap;
use tokio::time::{interval, Duration};
use tracing::{error, info, debug};
use sysinfo::{System, Process};

use crate::config::Config;
use crate::sync::{Event, SyncManager};

/// True iff this process is owned by an interactive user (i.e. an application the human launched),
/// not a Windows service / kernel-side helper. The agent only reports user-application processes —
/// otherwise the dashboard drowns in svchost/csrss/lsass/dwm noise for every endpoint.
///
/// Strategy: drop well-known Windows service-account SIDs by their prefix. Anything left is either
/// a real interactive user (DOMAIN\jdoe, MACHINE\user) or a process whose owner couldn't be
/// resolved — and we treat "unknown owner" as system, since real user apps almost always resolve.
///
/// Service SIDs dropped:
///   S-1-5-18           NT AUTHORITY\SYSTEM            (kernel + system services)
///   S-1-5-19           NT AUTHORITY\LOCAL SERVICE
///   S-1-5-20           NT AUTHORITY\NETWORK SERVICE
///   S-1-5-90-*         Window Manager (dwm.exe per-session)
///   S-1-5-93-*         User-Mode Driver Framework host
///   S-1-5-96-*         Font Driver Host
fn is_user_application_process(process: &Process) -> bool {
    let Some(uid) = process.user_id() else {
        return false; // unknown owner — treat as system / skip to keep dashboard quiet
    };
    let sid = uid.to_string();
    if sid == "S-1-5-18" || sid == "S-1-5-19" || sid == "S-1-5-20"
        || sid.starts_with("S-1-5-90-")
        || sid.starts_with("S-1-5-93-")
        || sid.starts_with("S-1-5-96-")
    {
        return false;
    }
    true
}

pub async fn start_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    if !config.monitoring.processes.enabled {
        info!("Process monitoring is disabled");
        return Ok(());
    }

    info!("Starting forensically reliable process monitoring");

    let mut sys = System::new_all();
    let storage = sync_manager.get_storage();
    
    // Forensic Resume: Load known processes from SQLite (Item 6.2)
    let mut known_processes: HashMap<usize, String> = match storage.load_state("process_known_list") {
        Ok(Some(v)) => serde_json::from_value(v).unwrap_or_default(),
        _ => HashMap::new(),
    };

    if !known_processes.is_empty() {
        info!("Forensic Resume: Reconciling {} persisted processes", known_processes.len());
    }

    let mut interval_timer = interval(Duration::from_secs(10)); // Check every 10s
    
    loop {
        interval_timer.tick().await;
        sys.refresh_processes();

        let current_processes = sys.processes();
        let mut current_map = HashMap::new();

        for (pid, process) in current_processes {
            // Filter out Windows service/system processes at the source — they should never
            // become events, never enter known_processes, and never trigger process_stopped.
            if !is_user_application_process(process) {
                continue;
            }
            let pid_val = pid.as_u32() as usize;
            let name = process.name().to_string();
            current_map.insert(pid_val, name.clone());

            if !known_processes.contains_key(&pid_val) {
                // NEW PROCESS DETECTED (Either just started, or started while agent was down)
                let (agent_id, _) = sync_manager.get_identity().await;
                let event = Event {
                    event_type: "process_started".to_string(),
                    timestamp: Utc::now(),
                    agent_id,
                    metadata: json!({
                        "pid": pid_val,
                        "process_name": name,
                        "executable_path": process.exe().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
                        "command_line": process.cmd().join(" "),
                        "parent_pid": process.parent().map(|p| p.as_u32()),
                        "user_id": process.user_id().map(|u| u.to_string()),
                        "was_offline": !known_processes.is_empty() // If we had state, this started while offline
                    }),
                };
                sync_manager.queue_event(event);
                debug!("Process started: {} (PID: {})", name, pid_val);
            }
        }

        // DETECT TERMINATED PROCESSES
        for (pid, name) in &known_processes {
            if !current_map.contains_key(pid) {
                let (agent_id, _) = sync_manager.get_identity().await;
                let event = Event {
                    event_type: "process_stopped".to_string(),
                    timestamp: Utc::now(),
                    agent_id,
                    metadata: json!({
                        "pid": pid,
                        "process_name": name,
                    }),
                };
                sync_manager.queue_event(event);
                debug!("Process stopped: {} (PID: {})", name, pid);
            }
        }

        // Update and Persist state
        known_processes = current_map;
        let _ = storage.save_state("process_known_list", &json!(known_processes));
    }
}
