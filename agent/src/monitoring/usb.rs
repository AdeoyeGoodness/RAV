use anyhow::Result;
use chrono::Utc;
use serde_json::json;
use std::sync::Arc;
use tokio::time::Duration;
use tracing::{debug, error, info, warn};

use crate::config::Config;
use crate::sync::{Event, SyncManager};

pub async fn start_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    if !config.monitoring.usb.enabled {
        info!("USB monitoring is disabled");
        return Ok(());
    }

    info!("Starting USB monitoring");

    // Platform-specific monitoring
    #[cfg(windows)]
    {
        start_windows_monitoring(config, sync_manager).await?;
    }

    #[cfg(target_os = "macos")]
    {
        start_macos_monitoring(config, sync_manager).await?;
    }

    #[cfg(target_os = "linux")]
    {
        start_linux_monitoring(config, sync_manager).await?;
    }

    Ok(())
}

#[cfg(windows)]
async fn start_windows_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    use std::collections::HashSet;
    use tokio::sync::Mutex;
    
    
    // Track USB drive letters for file monitoring
    let usb_drives: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    
    // Map drive letters to USB device IDs (to tie transfers to specific devices)
    let drive_to_device: Arc<Mutex<std::collections::HashMap<String, (String, String)>>> = Arc::new(Mutex::new(std::collections::HashMap::new()));

    // Cache device names on insertion so we can show proper names on removal
    let device_name_cache: Arc<Mutex<std::collections::HashMap<String, String>>> = Arc::new(Mutex::new(std::collections::HashMap::new()));

    // Forensic Resume: Load known devices from SQLite (Item 6.2)
    let storage = sync_manager.get_storage();
    let mut known = match storage.load_state("usb_known_devices") {
        Ok(Some(v)) => serde_json::from_value::<HashSet<String>>(v).unwrap_or_default(),
        _ => HashSet::new(),
    };
    
    // FORMAT MIGRATION: If the persisted state contains old-format PnP IDs
    // (from the previous 4-query detection), wipe it and re-baseline.
    // Old format IDs look like "USB\VID_...", "SWD\WPDBUSENUM\...", "USB_DRIVE_D", "usbstor#..."
    // New canonical IDs always start with "USB_" followed by serial/model.
    if !known.is_empty() {
        let has_old_format = known.iter().any(|id| {
            id.contains('\\') || id.contains('#') || id.starts_with("SWD") || id.starts_with("USB_DRIVE_")
        });
        if has_old_format {
            info!("USB state migration: Clearing {} old-format device IDs, will re-baseline", known.len());
            known.clear();
            let _ = storage.save_state("usb_known_devices", &json!(known));
        }
    }
    
    // Current state — use canonical detection for clean IDs
    let current_storage_devices = detect_usb_storage_devices().await.unwrap_or_default();
    let current_device_ids: HashSet<String> = current_storage_devices.keys().cloned().collect();
    let (agent_id, _) = sync_manager.get_identity().await;
    
    if !known.is_empty() {
        info!("Forensic Resume: Comparing current hardware state with {} persisted USB devices", known.len());
        
        // 1. Detect OFFLINE REMOVALS
        for device_id in &known.clone() {
            if !current_device_ids.contains(device_id) {
                info!("OFFLINE USB REMOVAL DETECTED: {}", device_id);
                sync_manager.queue_event(Event {
                    event_type: "usb_removed".to_string(),
                    timestamp: Utc::now(),
                    agent_id: agent_id.clone(),
                    metadata: json!({
                        "device_id": device_id,
                        "device_name": device_id, // Best effort — device is gone
                        "offline_activity": true
                    }),
                });
                known.remove(device_id);
            }
        }
        
        // 2. Detect OFFLINE INSERTIONS
        for (canonical_id, dev) in &current_storage_devices {
            if !known.contains(canonical_id) {
                info!("OFFLINE USB INSERTION DETECTED: {}", dev.friendly_name);
                sync_manager.queue_event(Event {
                    event_type: "usb_inserted".to_string(),
                    timestamp: Utc::now(),
                    agent_id: agent_id.clone(),
                    metadata: json!({
                        "device_id": canonical_id,
                        "device_name": dev.friendly_name,
                        "drive_letters": dev.drive_letters,
                        "offline_activity": true
                    }),
                });
                known.insert(canonical_id.clone());
            }
        }
        
        // Persist reconciled state
        let _ = storage.save_state("usb_known_devices", &json!(known));
    } else {
        // First run: Baseline everything
        info!("First run: Baselining {} USB storage devices", current_device_ids.len());
        for device_id in current_device_ids {
            known.insert(device_id);
        }
        let _ = storage.save_state("usb_known_devices", &json!(known));
    }

    let known_devices = Arc::new(Mutex::new(known));
    let mut tick = tokio::time::interval(Duration::from_secs(5));

    // Start offline USB file processing task
    let config_clone_offline = config.clone();
    let sync_manager_clone_offline = sync_manager.clone();
    tokio::spawn(async move {
        process_offline_usb_files(config_clone_offline, sync_manager_clone_offline).await;
    });

    // Start file transfer monitoring task
    if config.monitoring.usb.track_file_transfers {
        let sync_manager_ft = sync_manager.clone();
        let usb_drives_ft = usb_drives.clone();
        let drive_to_device_ft = drive_to_device.clone();
        
        tokio::spawn(async move {
            info!("=== USB File Transfer Monitoring Task INITIALIZED (Persistent) ===");
            
            let storage = sync_manager_ft.get_storage();
            let mut tick = tokio::time::interval(Duration::from_secs(5));
            
            // Forensic Resume: Load all state from SQLite
            let mut usb_snapshots: std::collections::HashMap<String, std::collections::HashMap<String, u64>> = 
                match storage.load_state("usb_snapshots") {
                    Ok(Some(v)) => serde_json::from_value(v).unwrap_or_default(),
                    _ => std::collections::HashMap::new(),
                };
            let mut sys_snapshots: std::collections::HashMap<String, std::collections::HashMap<String, u64>> = 
                match storage.load_state("usb_sys_snapshots") {
                    Ok(Some(v)) => serde_json::from_value(v).unwrap_or_default(),
                    _ => std::collections::HashMap::new(),
                };
            let mut usb_baselined: std::collections::HashSet<String> = 
                match storage.load_state("usb_baselined_set") {
                    Ok(Some(v)) => serde_json::from_value(v).unwrap_or_default(),
                    _ => std::collections::HashSet::new(),
                };
            let mut sys_baselined: std::collections::HashSet<String> = 
                match storage.load_state("usb_sys_baselined_set") {
                    Ok(Some(v)) => serde_json::from_value(v).unwrap_or_default(),
                    _ => std::collections::HashSet::new(),
                };
            let mut logged_keys: std::collections::HashSet<String> = 
                match storage.load_state("usb_logged_keys") {
                    Ok(Some(v)) => serde_json::from_value(v).unwrap_or_default(),
                    _ => std::collections::HashSet::new(),
                };

            if !usb_snapshots.is_empty() {
                info!("Forensic Resume: Loaded USB monitoring state from disk");
            }
            
            loop {
                tick.tick().await;
                
                let mut state_changed = false;
                let result: Result<()> = async {
                    let drives = usb_drives_ft.lock().await.clone();
                    let device_map = drive_to_device_ft.lock().await.clone();
                    
                    if drives.is_empty() && usb_snapshots.is_empty() {
                        return Ok(());
                    }
                    
                    // === STEP 1: Scan USB drives ===
                    for drive_letter in &drives {
                        let drive_path = format!("{}\\", drive_letter);
                        let path = std::path::Path::new(&drive_path);
                        
                        if !path.exists() { continue; }
                        
                        let mut current: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
                        walk_dir_files(path, &mut current, 5);
                        
                        let snapshot = usb_snapshots.entry(drive_letter.clone()).or_insert_with(std::collections::HashMap::new);
                        
                        if !usb_baselined.contains(drive_letter) {
                            info!("USB baseline for {}: found {} files", drive_letter, current.len());
                            *snapshot = current;
                            usb_baselined.insert(drive_letter.clone());
                            state_changed = true;
                            continue;
                        }
                        
                        let (device_id, device_name) = device_map.get(drive_letter)
                            .cloned()
                            .unwrap_or_else(|| (drive_letter.clone(), format!("USB Drive {}", drive_letter)));
                        
                        // NEW OR MODIFIED FILES (TO USB)
                        for (fpath, &fsize) in &current {
                            let mut is_new = false;
                            if let Some((_, old_size)) = find_path_case_insensitive(snapshot, fpath) {
                                if old_size != fsize {
                                    is_new = true; // Size changed = modified/overwritten
                                }
                            } else {
                                is_new = true; // Path is new
                            }

                            if is_new {
                                let dedup = format!("to_usb|{}|{}", fpath.to_uppercase(), fsize);
                                if logged_keys.contains(&dedup) { continue; }
                                logged_keys.insert(dedup.clone());
                                state_changed = true;
                                
                                let fname = std::path::Path::new(fpath).file_name().and_then(|n| n.to_str()).unwrap_or("Unknown").to_string();
                                info!("TRANSFER DETECTED: Copy to USB: {} on {}", fname, drive_letter);
                                
                                let (agent_id, _) = sync_manager_ft.get_identity().await;
                                sync_manager_ft.queue_event(Event {
                                    event_type: "usb_file_transfer".to_string(),
                                    timestamp: Utc::now(),
                                    agent_id,
                                    metadata: json!({
                                        "file_name": fname,
                                        "file_path": fpath,
                                        "file_size": fsize,
                                        "direction": "to_usb",
                                        "drive_letter": drive_letter,
                                        "device_id": device_id,
                                        "device_name": device_name,
                                        "was_offline": !logged_keys.is_empty(),
                                        "backup_file_id": serde_json::Value::Null
                                    }),
                                });
                            }
                        }
                        
                        // REMOVED OR OVERWRITTEN FILES (FROM USB)
                        for (fpath, &fsize) in snapshot.iter() {
                            let mut is_removed = false;
                            if let Some((_, current_size)) = find_path_case_insensitive(&current, fpath) {
                                if current_size != fsize {
                                    is_removed = true; // Size changed = old version is gone
                                }
                            } else {
                                is_removed = true; // Path is gone
                            }

                            if is_removed {
                                let dedup = format!("from_usb|{}|{}", fpath.to_uppercase(), fsize);
                                if logged_keys.contains(&dedup) { continue; }
                                logged_keys.insert(dedup.clone());
                                state_changed = true;
                                
                                let fname = std::path::Path::new(fpath).file_name().and_then(|n| n.to_str()).unwrap_or("Unknown").to_string();
                                info!("TRANSFER DETECTED: Removed from USB: {} from {}", fname, drive_letter);
                                
                                let (agent_id, _) = sync_manager_ft.get_identity().await;
                                sync_manager_ft.queue_event(Event {
                                    event_type: "usb_file_transfer".to_string(),
                                    timestamp: Utc::now(),
                                    agent_id,
                                    metadata: json!({
                                        "file_name": fname,
                                        "file_path": fpath,
                                        "file_size": fsize,
                                        "direction": "from_usb",
                                        "drive_letter": drive_letter,
                                        "device_id": device_id,
                                        "device_name": device_name,
                                        "was_offline": !logged_keys.is_empty(),
                                        "backup_file_id": serde_json::Value::Null
                                    }),
                                });
                            }
                        }
                        
                        if *snapshot != current {
                            *snapshot = current;
                            state_changed = true;
                        }
                    }
                    
                    // === STEP 2: System Scan (FROM USB TO SYSTEM) ===
                    // NOTE: the agent runs as LocalSystem, so std::env::var("USERPROFILE")
                    // resolves to C:\Windows\System32\config\systemprofile — NOT the
                    // logged-in user. Relying on it meant we scanned the service
                    // account's empty folders and never saw real copies. Instead,
                    // enumerate every real user's common folders across ALL fixed
                    // drives, plus the root of data drives. The removable `drives`
                    // (the USB sources) are excluded so we never treat the stick as a
                    // destination. Each entry is (path, walk_depth).
                    let watch_dirs: Vec<(String, u32)> = {
                        let removable: std::collections::HashSet<String> = drives.iter().cloned().collect();
                        let common = ["Desktop", "Downloads", "Documents", "Pictures", "Videos", "Music"];
                        let mut dirs: Vec<(String, u32)> = Vec::new();
                        for letter in b'C'..=b'Z' {
                            let dl = format!("{}:", letter as char);
                            if removable.contains(&dl) { continue; }
                            let root = format!("{}\\", dl);
                            if !std::path::Path::new(&root).exists() { continue; }
                            let users_dir = format!("{}Users", root);
                            if std::path::Path::new(&users_dir).exists() {
                                // System/user drive: watch each real user's common folders.
                                if let Ok(entries) = std::fs::read_dir(&users_dir) {
                                    for entry in entries.flatten() {
                                        if !entry.path().is_dir() { continue; }
                                        let uname = entry.file_name().to_string_lossy().to_lowercase();
                                        if matches!(uname.as_str(), "public" | "default" | "default user" | "all users" | "defaultuser0") {
                                            continue;
                                        }
                                        for sub in &common {
                                            let p = entry.path().join(sub);
                                            if p.exists() {
                                                dirs.push((p.to_string_lossy().to_string(), 3));
                                            }
                                        }
                                    }
                                }
                            } else {
                                // Data drive with no \Users — watch its root broadly.
                                dirs.push((root, 3));
                            }
                        }
                        dirs
                    };

                    if !watch_dirs.is_empty() {
                        let mut usb_file_lookup: std::collections::HashMap<String, (String, u64, String, String, String)> = std::collections::HashMap::new();
                        for (dl, files) in &usb_snapshots {
                            let (did, dname) = device_map.get(dl).cloned().unwrap_or_else(|| (dl.clone(), format!("USB Drive {}", dl)));
                            for (upath, &usize) in files {
                                if let Some(uname) = std::path::Path::new(upath).file_name().and_then(|n| n.to_str()) {
                                    let key = format!("{}|{}", uname.to_uppercase(), usize);
                                    usb_file_lookup.insert(key, (upath.clone(), usize, did.clone(), dname.clone(), dl.clone()));
                                }
                            }
                        }

                        for (sys_dir, depth) in &watch_dirs {
                            let sys_path = std::path::Path::new(sys_dir);
                            if !sys_path.exists() { continue; }

                            let mut current: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
                            walk_dir_files(sys_path, &mut current, *depth);

                            let snapshot = sys_snapshots.entry(sys_dir.clone()).or_insert_with(std::collections::HashMap::new);

                            if !sys_baselined.contains(sys_dir) {
                                *snapshot = current;
                                sys_baselined.insert(sys_dir.clone());
                                state_changed = true;
                                continue;
                            }

                            for (fpath, &fsize) in &current {
                                let mut is_new = false;
                                if let Some((_, old_size)) = find_path_case_insensitive(snapshot, fpath) {
                                    if old_size != fsize {
                                        is_new = true;
                                    }
                                } else {
                                    is_new = true;
                                }

                                if !is_new { continue; }

                                let fname = std::path::Path::new(fpath).file_name().and_then(|n| n.to_str()).unwrap_or("Unknown").to_string();
                                let lookup_key = format!("{}|{}", fname.to_uppercase(), fsize);

                                if let Some((usb_path, _, device_id, device_name, drive_letter)) = usb_file_lookup.get(&lookup_key) {
                                    let dedup = format!("from_usb_to_system|{}|{}", fpath.to_uppercase(), fsize);
                                    if logged_keys.contains(&dedup) { continue; }
                                    logged_keys.insert(dedup);

                                    info!("TRANSFER DETECTED: Copy from USB to system: {} ({} bytes) from {}", fname, fsize, usb_path);

                                    let (agent_id, _) = sync_manager_ft.get_identity().await;
                                    sync_manager_ft.queue_event(Event {
                                        event_type: "usb_file_transfer".to_string(),
                                        timestamp: Utc::now(),
                                        agent_id,
                                        metadata: json!({
                                            "file_name": fname,
                                            "file_path": fpath,
                                            "file_size": fsize,
                                            "direction": "from_usb_to_system",
                                            "source_path": usb_path,
                                            "drive_letter": drive_letter,
                                            "device_id": device_id,
                                            "device_name": device_name,
                                            "platform": "windows",
                                            "backup_file_id": serde_json::Value::Null
                                        }),
                                    });
                                    sync_manager_ft.sync_events_immediate().await;
                                }
                            }
                            *snapshot = current;
                        }
                    }
                    
                    if logged_keys.len() > 5000 { logged_keys.clear(); }
                    usb_baselined.retain(|d| drives.contains(d));
                    usb_snapshots.retain(|d, _| drives.contains(d));
                    
                    if state_changed {
                        let _ = storage.save_state("usb_snapshots", &json!(usb_snapshots));
                        let _ = storage.save_state("usb_sys_snapshots", &json!(sys_snapshots));
                        let _ = storage.save_state("usb_baselined_set", &json!(usb_baselined));
                        let _ = storage.save_state("usb_sys_baselined_set", &json!(sys_baselined));
                        let _ = storage.save_state("usb_logged_keys", &json!(logged_keys));
                    }

                    Ok(())
                }.await;
                
                if let Err(e) = result {
                    error!("USB monitoring loop error: {}", e);
                }
            }
        });
    }

    loop {
        tick.tick().await;

        match detect_usb_storage_devices().await {
            Ok(current_storage) => {
                let mut known = known_devices.lock().await;
                let current_ids: std::collections::HashSet<String> = current_storage.keys().cloned().collect();
                
                // Update drive letter tracking for file transfer monitoring
                {
                    let mut drives = usb_drives.lock().await;
                    let mut drive_map = drive_to_device.lock().await;
                    
                    for (canonical_id, dev) in &current_storage {
                        for dl in &dev.drive_letters {
                            if !drives.contains(dl) {
                                info!("USB drive mounted: {} ({})", dl, dev.friendly_name);
                                drives.insert(dl.clone());
                                drive_map.insert(dl.clone(), (canonical_id.clone(), dev.friendly_name.clone()));
                            }
                        }
                    }
                    // Remove drives that are no longer available
                    let all_current_drives: std::collections::HashSet<String> = current_storage.values()
                        .flat_map(|d| d.drive_letters.iter().cloned())
                        .collect();
                    drives.retain(|d| all_current_drives.contains(d));
                    drive_map.retain(|d, _| all_current_drives.contains(d));
                }
                
                // Detect NEW devices (one event per physical device)
                for (canonical_id, dev) in &current_storage {
                    if !known.contains(canonical_id) {
                        info!("USB device inserted: {}", dev.friendly_name);
                        known.insert(canonical_id.clone());
                        let _ = storage.save_state("usb_known_devices", &json!(*known));
                        
                        // Cache name for removal
                        {
                            let mut name_cache = device_name_cache.lock().await;
                            name_cache.insert(canonical_id.clone(), dev.friendly_name.clone());
                        }
                        
                        let (agent_id, _) = sync_manager.get_identity().await;
                        sync_manager.queue_event(Event {
                            event_type: "usb_inserted".to_string(),
                            timestamp: Utc::now(),
                            agent_id,
                            metadata: json!({
                                "device_id": canonical_id,
                                "device_name": dev.friendly_name,
                                "drive_letters": dev.drive_letters,
                                "volume_name": dev.volume_name,
                                "platform": "windows"
                            }),
                        });
                    }
                }

                // Detect REMOVED devices
                let removed: Vec<String> = known.difference(&current_ids).cloned().collect();
                for device_id in removed {
                    let device_name = {
                        let mut name_cache = device_name_cache.lock().await;
                        name_cache.remove(&device_id).unwrap_or_else(|| device_id.clone())
                    };
                    
                    info!("USB device removed: {}", device_name);
                    known.remove(&device_id);
                    let _ = storage.save_state("usb_known_devices", &json!(*known));
                    
                    let (agent_id, _) = sync_manager.get_identity().await;
                    sync_manager.queue_event(Event {
                        event_type: "usb_removed".to_string(),
                        timestamp: Utc::now(),
                        agent_id,
                        metadata: json!({
                            "device_id": device_id,
                            "device_name": device_name,
                            "platform": "windows"
                        }),
                    });
                }
            }
            Err(e) => {
                error!("USB device detection error: {}", e);
            }
        }
    }
}

/// Represents a single physical USB storage device (canonical, deduplicated).
#[cfg(windows)]
#[derive(Debug, Clone)]
struct UsbStorageDevice {
    /// Canonical key: e.g. "GENERAL_UDISK_5.00" (vendor+product+rev)
    canonical_id: String,
    /// Human-readable name: e.g. "SanDisk Ultra (D:)" or "General UDisk (D:)"
    friendly_name: String,
    /// Drive letters associated with this device
    drive_letters: Vec<String>,
    /// Raw USBSTOR PnP device ID (for internal tracking)
    raw_device_id: String,
    /// Volume label if available
    volume_name: String,
}

/// Detect USB storage devices as ONE canonical entry per physical device.
/// Returns a HashMap of canonical_id -> UsbStorageDevice.
#[cfg(windows)]
async fn detect_usb_storage_devices() -> Result<std::collections::HashMap<String, UsbStorageDevice>> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut devices = std::collections::HashMap::new();

    // Single comprehensive PowerShell query:
    // Get USB disks, their partitions, volumes, AND friendly names — all in one shot.
    let ps_script = r#"
        $results = @()
        $usbDisks = Get-Disk | Where-Object { $_.BusType -eq 'USB' -or $_.BusType -eq 'SD' }
        foreach ($disk in $usbDisks) {
            $partitions = Get-Partition -DiskNumber $disk.Number -ErrorAction SilentlyContinue
            $driveLetters = @()
            $volumeName = ''
            foreach ($part in $partitions) {
                if ($part.DriveLetter) {
                    $driveLetters += "$($part.DriveLetter):"
                    $vol = Get-Volume -DriveLetter $part.DriveLetter -ErrorAction SilentlyContinue
                    if ($vol -and $vol.FileSystemLabel) { $volumeName = $vol.FileSystemLabel }
                }
            }
            $pnp = Get-PnpDevice -FriendlyName $disk.FriendlyName -ErrorAction SilentlyContinue | Select-Object -First 1
            $results += [PSCustomObject]@{
                DiskNumber  = $disk.Number
                FriendlyName = $disk.FriendlyName
                SerialNumber = $disk.SerialNumber
                Size = $disk.Size
                DriveLetters = ($driveLetters -join ',')
                VolumeName = $volumeName
                PnpInstanceId = if ($pnp) { $pnp.InstanceId } else { '' }
                Model = $disk.Model
            }
        }
        $results | ConvertTo-Json -Compress
    "#;

    let output = Command::new("powershell")
        .args(&["-Command", ps_script])
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    if let Ok(output) = output {
        let output_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !output_str.is_empty() {
            // Parse JSON — could be a single object or an array
            if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&output_str) {
                let items: Vec<&serde_json::Value> = if let Some(arr) = json_val.as_array() {
                    arr.iter().collect()
                } else {
                    vec![&json_val]
                };

                for item in items {
                    let friendly = item.get("FriendlyName").and_then(|v| v.as_str()).unwrap_or("USB Device");
                    let serial = item.get("SerialNumber").and_then(|v| v.as_str()).unwrap_or("");
                    let model = item.get("Model").and_then(|v| v.as_str()).unwrap_or("");
                    let drive_str = item.get("DriveLetters").and_then(|v| v.as_str()).unwrap_or("");
                    let volume_name = item.get("VolumeName").and_then(|v| v.as_str()).unwrap_or("");
                    let pnp_id = item.get("PnpInstanceId").and_then(|v| v.as_str()).unwrap_or("");
                    let size = item.get("Size").and_then(|v| v.as_u64()).unwrap_or(0);

                    let drive_letters: Vec<String> = drive_str
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();

                    // Build canonical ID from serial (unique per physical device)
                    // Fallback to model+size if serial is empty
                    let canonical_id = if !serial.is_empty() && serial.len() > 4 {
                        format!("USB_{}", serial.trim())
                    } else if !model.is_empty() {
                        format!("USB_{}_{}", model.trim().replace(' ', "_"), size / (1024 * 1024))
                    } else {
                        format!("USB_{}_{}", friendly.trim().replace(' ', "_"), size / (1024 * 1024))
                    };

                    // Build a clean human-readable name
                    let display_name = if !volume_name.is_empty() && !drive_letters.is_empty() {
                        format!("{} — {} ({})", volume_name, friendly, drive_letters.join(", "))
                    } else if !drive_letters.is_empty() {
                        format!("{} ({})", friendly, drive_letters.join(", "))
                    } else {
                        friendly.to_string()
                    };

                    devices.insert(canonical_id.clone(), UsbStorageDevice {
                        canonical_id,
                        friendly_name: display_name,
                        drive_letters,
                        raw_device_id: pnp_id.to_string(),
                        volume_name: volume_name.to_string(),
                    });
                }
            }
        }
    }

    Ok(devices)
}

/// Legacy detect_usb_devices — now wraps the canonical detection and returns
/// just the set of canonical IDs for backward compatibility with the known_devices set.
#[cfg(windows)]
async fn detect_usb_devices() -> Result<std::collections::HashSet<String>> {
    let devices = detect_usb_storage_devices().await?;
    Ok(devices.keys().cloned().collect())
}

#[cfg(windows)]
fn extract_device_id_from_path(path: &str) -> Option<String> {
    // Paths from Get-Disk usually look like: \\?\USBSTOR#Disk&Ven_SanDisk&Prod_Ultra&Rev_1.00#...
    // Or for phones: \\?\USB#VID_04E8&PID_6860...
    let path_upper = path.to_uppercase();
    
    if path_upper.contains("USBSTOR") || path_upper.contains("USB#") {
        // Find the start of the identifier (after the first # or \)
        let markers = ["USBSTOR#", "USBSTOR\\", "USB#", "USB\\"];
        for marker in markers {
            if let Some(start) = path_upper.find(marker) {
                // The ID is usually everything from the marker until the next # or the end
                let rest = &path[start..];
                if let Some(end) = rest[marker.len()..].find('#') {
                    return Some(rest[..marker.len() + end].to_string());
                }
                return Some(rest.to_string());
            }
        }
    }
    None
}

#[cfg(windows)]
async fn get_usb_device_details() -> Result<std::collections::HashMap<String, String>> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    
    let mut device_map = std::collections::HashMap::new();
    
    // Get device friendly names using PowerShell (improved to catch phones which show up as WPD/MTP)
    let output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-PnpDevice -Class USB,WPD,DiskDrive -Status OK | Select-Object InstanceId, FriendlyName | ConvertTo-Json"
        ])
        .creation_flags(0x08000000)
        .output();
    
    if let Ok(output) = output {
        let output_str = String::from_utf8_lossy(&output.stdout);
        // Parse JSON output to extract InstanceId and FriendlyName pairs
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(&output_str) {
            if let Some(array) = json_value.as_array() {
                for item in array {
                    if let (Some(instance_id), Some(friendly_name)) = (
                        item.get("InstanceId").and_then(|v| v.as_str()),
                        item.get("FriendlyName").and_then(|v| v.as_str())
                    ) {
                        device_map.insert(instance_id.to_string(), friendly_name.to_string());
                    }
                }
            } else if let Some(obj) = json_value.as_object() {
                // Single object case
                if let (Some(instance_id), Some(friendly_name)) = (
                    obj.get("InstanceId").and_then(|v| v.as_str()),
                    obj.get("FriendlyName").and_then(|v| v.as_str())
                ) {
                    device_map.insert(instance_id.to_string(), friendly_name.to_string());
                }
            }
        }
    }
    
    // Also get logical disk names for USB drives
    let disk_output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 } | Select-Object DeviceID, VolumeName | ConvertTo-Json"
        ])
        .creation_flags(0x08000000)
        .output();
    
    if let Ok(output) = disk_output {
        let output_str = String::from_utf8_lossy(&output.stdout);
        if let Ok(json_value) = serde_json::from_str::<serde_json::Value>(&output_str) {
            if let Some(array) = json_value.as_array() {
                for item in array {
                    if let Some(device_id) = item.get("DeviceID").and_then(|v| v.as_str()) {
                        let volume_name = item.get("VolumeName").and_then(|v| v.as_str()).unwrap_or("");
                        let key = format!("USB_DRIVE_{}", device_id.replace(":", ""));
                        let name = if volume_name.is_empty() {
                            format!("USB Mass Storage Device ({})", device_id)
                        } else {
                            format!("{} ({})", volume_name, device_id)
                        };
                        device_map.insert(key, name);
                    }
                }
            } else if let Some(obj) = json_value.as_object() {
                // Single drive case (not an array)
                if let Some(device_id) = obj.get("DeviceID").and_then(|v| v.as_str()) {
                    let volume_name = obj.get("VolumeName").and_then(|v| v.as_str()).unwrap_or("");
                    let key = format!("USB_DRIVE_{}", device_id.replace(":", ""));
                    let name = if volume_name.is_empty() {
                        format!("USB Mass Storage Device ({})", device_id)
                    } else {
                        format!("{} ({})", volume_name, device_id)
                    };
                    device_map.insert(key, name);
                }
            }
        }
    }
    
    Ok(device_map)
}

fn is_safe_drive_letter(drive: &str) -> bool {
    // Valid Windows drive letter: "C:" or "D:"
    // 2 chars, first is alphabetic, second is ':'
    if drive.len() != 2 {
        return false;
    }
    let chars: Vec<char> = drive.chars().collect();
    chars[0].is_ascii_alphabetic() && chars[1] == ':'
}

#[cfg(windows)]
async fn take_initial_snapshot(drive_letter: &str) -> Result<std::collections::HashMap<String, u64>> {
    use std::path::Path;

    // SECURITY: Validate drive letter to prevent Path Traversal
    if !is_safe_drive_letter(drive_letter) {
        tracing::warn!("Security Warning: Invalid drive letter detected: {}", drive_letter);
        return Ok(std::collections::HashMap::new());
    }
    
    let drive_path = format!("{}\\" , drive_letter);
    let path = Path::new(&drive_path);
    let mut snapshot = std::collections::HashMap::new();
    
    if path.exists() {
        debug!("Starting recursive snapshot of USB drive {}", drive_path);
        walk_dir_files(path, &mut snapshot, 5); 
        debug!("Snapshot of {} finished: {} files found", drive_path, snapshot.len());
    } else {
        warn!("USB drive path {} does not exist for snapshot", drive_path);
    }
    
    Ok(snapshot)
}

#[cfg(windows)]
fn walk_dir_files(dir: &std::path::Path, out: &mut std::collections::HashMap<String, u64>, max_depth: u32) {
    use std::fs;
    if max_depth == 0 { return; }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_file() {
                if let Ok(metadata) = fs::metadata(&entry_path) {
                    // Use original path for key to preserve casing, but we'll do case-insensitive checks later
                    out.insert(entry_path.to_string_lossy().to_string(), metadata.len());
                }
            } else if entry_path.is_dir() {
                let name = entry_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("");
                if !name.starts_with('$') && !name.starts_with('.') && name != "System Volume Information" {
                    walk_dir_files(&entry_path, out, max_depth - 1);
                }
            }
        }
    }
}

/// Helper for case-insensitive HashMap lookup on Windows paths
fn find_path_case_insensitive(map: &std::collections::HashMap<String, u64>, path: &str) -> Option<(String, u64)> {
    let target_upper = path.to_uppercase();
    for (k, v) in map {
        if k.to_uppercase() == target_upper {
            return Some((k.clone(), *v));
        }
    }
    None
}

fn path_exists_in_map(map: &std::collections::HashMap<String, u64>, path: &str) -> bool {
    find_path_case_insensitive(map, path).is_some()
}

fn drive_letter_from_path(path: &str) -> Option<String> {
    let path = path.trim();
    if path.len() >= 2 {
        let chars: Vec<char> = path.chars().collect();
        if chars[0].is_ascii_alphabetic() && chars[1] == ':' {
            return Some(format!("{}:", chars[0]));
        }
    }
    None
}

fn transfer_dedup_key(direction: &str, file_path: &str, file_size: u64) -> String {
    format!("{}|{}|{}", direction, file_path.to_uppercase(), file_size)
}

#[cfg(windows)]
async fn monitor_system_for_usb_files(
    device_map: &std::collections::HashMap<String, (String, String)>,
    system_snapshots: &mut std::collections::HashMap<String, std::collections::HashMap<String, u64>>,
    system_dirs_bootstrapped: &mut std::collections::HashSet<String>,
    recent_usb_removals: &mut std::collections::VecDeque<(String, String, u64, String, String, chrono::DateTime<chrono::Utc>)>,
    recent_system_removals: &mut std::collections::VecDeque<(String, String, u64, chrono::DateTime<chrono::Utc>)>,
    pending_usb_removals: &mut std::collections::VecDeque<(String, String, u64, String, String, String, chrono::DateTime<chrono::Utc>)>,
    recent_transfer_keys: &mut std::collections::HashSet<String>,
    usb_snapshots: &std::collections::HashMap<String, std::collections::HashMap<String, u64>>,
    sync_manager: SyncManager,
    config: Config,
) -> Result<()> {
    use std::path::Path;
    
    // Monitor common system directories where files are typically copied FROM USB
    let system_dirs = vec![
        std::env::var("USERPROFILE").unwrap_or_default() + "\\Downloads",
        std::env::var("USERPROFILE").unwrap_or_default() + "\\Desktop",
        std::env::var("USERPROFILE").unwrap_or_default() + "\\Documents",
    ];
    
    for system_dir in system_dirs {
        let sys_path = Path::new(&system_dir);
        if !sys_path.exists() {
            continue;
        }
        
        let snapshot = system_snapshots.entry(system_dir.clone()).or_insert_with(std::collections::HashMap::new);
        let mut current_files: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        
        // Recursively scan (2 levels deep covers e.g. Documents/MyProject/file.txt)
        walk_dir_files(sys_path, &mut current_files, 2);
        
        // First pass: baseline existing files so we don't treat Downloads/Desktop contents as transfers
        if !system_dirs_bootstrapped.contains(&system_dir) {
            *snapshot = current_files.clone();
            system_dirs_bootstrapped.insert(system_dir.clone());
            info!("System folder baseline for USB monitoring: {} ({} files)", system_dir, snapshot.len());
            continue;
        }
                        
        for (file_path, &file_size) in &current_files {
            let entry_path = std::path::Path::new(file_path);
            
            // Check if file is new or modified
            let existing_in_snapshot = find_path_case_insensitive(snapshot, file_path);
            
            if existing_in_snapshot.is_none() || existing_in_snapshot.as_ref().unwrap().1 != file_size {
                let file_name = entry_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                    
                // Try to find source USB path from recent USB file removals (CUT/MOVE)
                let usb_match_removed = find_matching_usb_removal(&file_name, file_size, recent_usb_removals);
                
                // Try to find source USB path from current USB files (COPY)
                let usb_match_copied = find_matching_usb_current_path(&file_name, file_size, usb_snapshots, device_map);
                
                let usb_match = usb_match_removed.or(usb_match_copied);
                
                if let Some((src_path, device_id, device_name, drive_letter)) = usb_match {
                    info!("Detected file copied FROM USB to system: {} ({} bytes) from {}", 
                          file_path, file_size, src_path);
                    
                    // Matched to a monitored folder — cancel pending fallback from_usb for this file
                    pending_usb_removals.retain(|(n, p, s, _, _, _, _)| {
                        !(*s == file_size && (n == &file_name || p == &src_path))
                    });
                    
                    if let Err(e) = log_file_transfer(
                        file_path.clone(),
                        file_size,
                        "from_usb_to_system".to_string(),
                        drive_letter,
                        device_id,
                        device_name,
                        Some(src_path),
                        None,
                        recent_transfer_keys,
                        sync_manager.clone(),
                        config.clone(),
                    ).await {
                        error!("Failed to log from_usb_to_system for {}: {}", file_path, e);
                    }
                }
            }
        }
        
        // Check for files that were removed from system directories
        for (file_path, &old_size) in snapshot.iter() {
            if !path_exists_in_map(&current_files, file_path) {
                let file_name = std::path::Path::new(file_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                
                recent_system_removals.push_back((
                    file_name,
                    file_path.clone(),
                    old_size,
                    chrono::Utc::now(),
                ));
            }
        }
        
        // Update snapshot
        *snapshot = current_files;
    }
    
    Ok(())
}

// Helper function to find matching source path from system file removals
#[cfg(windows)]
fn find_matching_source_path(
    file_name: &str,
    file_size: u64,
    recent_removals: &std::collections::VecDeque<(String, String, u64, chrono::DateTime<chrono::Utc>)>,
) -> Option<String> {
    let file_name_upper = file_name.to_uppercase();
    // Look for a recently removed file with matching name and size
    for (removed_name, removed_path, removed_size, _) in recent_removals.iter().rev() {
        if removed_name.to_uppercase() == file_name_upper && *removed_size == file_size {
            return Some(removed_path.clone());
        }
    }
    // If no exact match, try size-only match (in case file was renamed)
    for (_, removed_path, removed_size, _) in recent_removals.iter().rev() {
        if *removed_size == file_size {
            return Some(removed_path.clone());
        }
    }
    None
}

// Match a system file to a recently removed USB file (returns path + device info + drive letter)
#[cfg(windows)]
fn find_matching_usb_removal(
    file_name: &str,
    file_size: u64,
    recent_removals: &std::collections::VecDeque<(String, String, u64, String, String, chrono::DateTime<chrono::Utc>)>,
) -> Option<(String, String, String, String)> {
    let file_name_upper = file_name.to_uppercase();
    for (removed_name, removed_path, removed_size, device_id, device_name, _) in recent_removals.iter().rev() {
        if removed_name.to_uppercase() == file_name_upper && *removed_size == file_size {
            let drive = drive_letter_from_path(removed_path).unwrap_or_default();
            return Some((removed_path.clone(), device_id.clone(), device_name.clone(), drive));
        }
    }
    for (_, removed_path, removed_size, device_id, device_name, _) in recent_removals.iter().rev() {
        if *removed_size == file_size {
            let drive = drive_letter_from_path(removed_path).unwrap_or_default();
            return Some((removed_path.clone(), device_id.clone(), device_name.clone(), drive));
        }
    }
    None
}

// Match a system file to a file still present on USB (COPY, not move)
#[cfg(windows)]
fn find_matching_usb_current_path(
    file_name: &str,
    file_size: u64,
    usb_snapshots: &std::collections::HashMap<String, std::collections::HashMap<String, u64>>,
    device_map: &std::collections::HashMap<String, (String, String)>,
) -> Option<(String, String, String, String)> {
    let file_name_upper = file_name.to_uppercase();
    for (drive_letter, files) in usb_snapshots {
        for (usb_path, &usb_size) in files {
            let usb_file_name = std::path::Path::new(usb_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown");
                
            if usb_file_name.to_uppercase() == file_name_upper && usb_size == file_size {
                let (device_id, device_name) = device_map.get(drive_letter)
                    .cloned()
                    .unwrap_or_else(|| (drive_letter.clone(), format!("USB Drive {}", drive_letter)));
                return Some((usb_path.clone(), device_id, device_name, drive_letter.clone()));
            }
        }
    }
    None
}

#[cfg(windows)]
async fn get_usb_drive_letters() -> Result<std::collections::HashSet<String>> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    
    let mut drive_set = std::collections::HashSet::new();
    
    let mut collect_drives = |stdout: &[u8]| {
        let output_str = String::from_utf8_lossy(stdout);
        for line in output_str.lines() {
            let line = line.trim();
            if line.len() == 2 && line.ends_with(':') && line.chars().next().map(|c| c.is_ascii_alphabetic()).unwrap_or(false) {
                drive_set.insert(line.to_string());
            }
        }
    };
    
    // Removable + USB-attached fixed disks (many external drives report as DriveType 3)
    let wmi_output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 -or ($_.DriveType -eq 3 -and $_.MediaType -eq 11) } | Select-Object -ExpandProperty DeviceID"
        ])
        .creation_flags(0x08000000)
        .output();
    if let Ok(output) = wmi_output {
        collect_drives(&output.stdout);
    }
    
    // Volumes on disks with BusType USB (catches drives WMI misses)
    let usb_bus_output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-Disk | Where-Object { $_.BusType -eq 'USB' } | Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object { $_.DriveLetter + ':' }"
        ])
        .creation_flags(0x08000000)
        .output();
    if let Ok(output) = usb_bus_output {
        collect_drives(&output.stdout);
    }
    
    Ok(drive_set)
}

#[cfg(windows)]
async fn scan_usb_drive_files(drive_letter: &str) -> Result<std::collections::HashMap<String, u64>> {
    use std::path::Path;
    
    if !is_safe_drive_letter(drive_letter) {
        return Ok(std::collections::HashMap::new());
    }
    
    let drive_path = format!("{}\\", drive_letter);
    let path = Path::new(&drive_path);
    if !path.exists() {
        return Ok(std::collections::HashMap::new());
    }
    
    let mut current_files = std::collections::HashMap::new();
    walk_dir_files(path, &mut current_files, 5);
    debug!("USB scan: {} files on {}", current_files.len(), drive_letter);
    Ok(current_files)
}

#[cfg(windows)]
fn process_usb_removals(
    drive_letter: &str,
    device_id: &str,
    device_name: &str,
    last_snapshot: &std::collections::HashMap<String, u64>,
    current_files: &std::collections::HashMap<String, u64>,
    recent_usb_removals: &mut std::collections::VecDeque<(String, String, u64, String, String, chrono::DateTime<chrono::Utc>)>,
    pending_usb_removals: &mut std::collections::VecDeque<(String, String, u64, String, String, String, chrono::DateTime<chrono::Utc>)>,
) {
    let drive_path_upper = format!("{}\\", drive_letter).to_uppercase();
    for (file_path, &old_size) in last_snapshot.iter() {
        if !path_exists_in_map(current_files, file_path) && file_path.to_uppercase().starts_with(&drive_path_upper) {
            let file_name = std::path::Path::new(file_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();
            
            recent_usb_removals.push_back((
                file_name.clone(),
                file_path.clone(),
                old_size,
                device_id.to_string(),
                device_name.to_string(),
                chrono::Utc::now(),
            ));
            
            pending_usb_removals.push_back((
                file_name,
                file_path.clone(),
                old_size,
                device_id.to_string(),
                device_name.to_string(),
                drive_letter.to_string(),
                chrono::Utc::now(),
            ));
        }
    }
}

#[cfg(windows)]
async fn process_usb_additions(
    drive_letter: &str,
    device_id: &str,
    device_name: &str,
    last_snapshot: &mut std::collections::HashMap<String, u64>,
    current_files: &std::collections::HashMap<String, u64>,
    recent_system_removals: &mut std::collections::VecDeque<(String, String, u64, chrono::DateTime<chrono::Utc>)>,
    recent_transfer_keys: &mut std::collections::HashSet<String>,
    sync_manager: SyncManager,
    config: Config,
) -> Result<()> {
    for (full_path, &file_size) in current_files {
        let entry_path = std::path::Path::new(full_path);
        let file_name = entry_path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();
        
        if let Some((orig_path, old_size)) = find_path_case_insensitive(last_snapshot, full_path) {
            if old_size != file_size {
                let source_path = find_matching_source_path(&file_name, file_size, recent_system_removals);
                log_file_transfer(
                    orig_path,
                    file_size,
                    "to_usb".to_string(),
                    drive_letter.to_string(),
                    device_id.to_string(),
                    device_name.to_string(),
                    source_path,
                    None,
                    recent_transfer_keys,
                    sync_manager.clone(),
                    config.clone(),
                ).await?;
            }
        } else {
            let source_path = find_matching_source_path(&file_name, file_size, recent_system_removals);
            log_file_transfer(
                full_path.clone(),
                file_size,
                "to_usb".to_string(),
                drive_letter.to_string(),
                device_id.to_string(),
                device_name.to_string(),
                source_path,
                None,
                recent_transfer_keys,
                sync_manager.clone(),
                config.clone(),
            ).await?;
        }
    }
    
    *last_snapshot = current_files.clone();
    Ok(())
}

#[cfg(windows)]
async fn log_file_transfer(
    file_path: String,
    file_size: u64,
    direction: String,
    drive_letter: String,
    device_id: String,
    device_name: String,
    source_path: Option<String>,
    destination_path: Option<String>,
    recent_transfer_keys: &mut std::collections::HashSet<String>,
    sync_manager: SyncManager,
    config: Config,
) -> Result<()> {
    use std::path::Path;
    
    let dedup_key = transfer_dedup_key(&direction, &file_path, file_size);
    if !recent_transfer_keys.insert(dedup_key) {
        debug!("Skipping duplicate USB transfer event: {} {}", direction, file_path);
        return Ok(());
    }
    if recent_transfer_keys.len() > 500 {
        recent_transfer_keys.clear();
        recent_transfer_keys.insert(transfer_dedup_key(&direction, &file_path, file_size));
    }
    
    let path = Path::new(&file_path);
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    info!("USB file transfer detected: {} {} ({}) on device {} ({})", 
          direction, file_name, file_path, device_id, device_name);
    
    // IMPORTANT: Queue the event FIRST so it shows up on the dashboard immediately.
    // File backup happens in background and won't block detection of subsequent transfers.
    let mut metadata = json!({
        "file_name": file_name,
        "file_path": file_path,
        "file_size": file_size,
        "direction": direction,
        "drive_letter": drive_letter,
        "device_id": device_id.clone(),
        "device_name": device_name.clone(),
        "platform": "windows",
        "backup_file_id": serde_json::Value::Null
    });
    
    if let Some(ref src) = source_path {
        metadata["source_path"] = json!(src);
    }
    
    if let Some(ref dst) = destination_path {
        metadata["destination_path"] = json!(dst);
    }
    
    let (agent_id, _) = sync_manager.get_identity().await;
    let event = Event {
        event_type: "usb_file_transfer".to_string(),
        timestamp: Utc::now(),
        agent_id,
        metadata,
    };
    
    sync_manager.queue_event(event);
    // Push to backend immediately so dashboard sees it fast
    sync_manager.sync_events_immediate().await;
    
    // Spawn file backup in background — never blocks the monitoring loop
    let file_path_bg = file_path.clone();
    let file_name_bg = file_name.clone();
    let direction_bg = direction.clone();
    let sm_bg = sync_manager.clone();
    let cfg_bg = config.clone();
    tokio::spawn(async move {
        if std::path::Path::new(&file_path_bg).exists() && file_size > 0 && file_size < 10 * 1024 * 1024 {
            if direction_bg == "to_usb" || direction_bg == "from_usb_to_system" {
                match backup_and_upload_file(&file_path_bg, &file_name_bg, file_size, &sm_bg, &cfg_bg).await {
                    Ok(backup_id) => info!("File backed up: {} -> {}", file_name_bg, backup_id),
                    Err(e) => warn!("Backup skipped for {}: {}", file_name_bg, e),
                }
            }
        }
    });
    
    Ok(())
}

#[cfg(windows)]
async fn backup_and_upload_file(
    source_path: &str,
    file_name: &str,
    file_size: u64,
    _sync_manager: &SyncManager,
    config: &Config,
) -> Result<String> {
    use std::fs;
    use sha2::{Sha256, Digest};
    use reqwest::multipart;
    
    // Read source file
    let file_data = fs::read(source_path)?;
    
    // Generate file ID from hash
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    hasher.update(file_name.as_bytes());
    hasher.update(source_path.as_bytes());
    let file_hash = format!("{:x}", hasher.finalize());
    let file_id = format!("{}_{}", 
        chrono::Utc::now().format("%Y%m%d_%H%M%S"),
        &file_hash[..16]
    );
    
    // Upload file to backend
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300)) // 5 minute timeout for file uploads
        .connect_timeout(std::time::Duration::from_secs(30)) // 30 second connection timeout
        .build()?;
    
    let url = format!("{}/api/v1/files/upload", config.backend.url);
    
    let (agent_id, _) = _sync_manager.get_identity().await;
    
    // Create multipart form (cloned for offline retry if needed)
    let form = multipart::Form::new()
        .text("file_id", file_id.clone())
        .text("file_name", file_name.to_string())
        .text("agent_id", agent_id.clone())
        .text("file_path", source_path.to_string())
        .text("file_size", file_size.to_string())
        .part("file", multipart::Part::bytes(file_data.clone())
            .file_name(file_name.to_string())
            .mime_str("application/octet-stream")?);
    
    let mut request = client.post(&url).multipart(form);
    
    if let Some(api_key) = &config.backend.api_key {
        request = request.header("X-API-Key", api_key);
    }
    
    let response = match request.send().await {
        Ok(res) => res,
        Err(e) => {
            tracing::warn!("Failed to upload USB file: {}, caching offline", e);
            save_usb_to_offline_cache(&file_id, file_name, source_path, file_size, &file_data)?;
            return Ok(file_id);
        }
    };
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::warn!("Backend returned error {}: {}, caching offline", status, body);
        save_usb_to_offline_cache(&file_id, file_name, source_path, file_size, &file_data)?;
        return Ok(file_id);
    }
    
    info!("File uploaded to backend: {} ({} bytes)", file_id, file_size);
    
    Ok(file_id)
}

#[cfg(windows)]
fn save_usb_to_offline_cache(
    file_id: &str,
    file_name: &str,
    source_path: &str,
    file_size: u64,
    file_data: &[u8],
) -> Result<()> {
    use std::fs;
    let offline_dir = std::path::Path::new("C:\\ProgramData\\RAV\\offline_usb_files");
    let _ = fs::create_dir_all(offline_dir);
    
    let bin_path = offline_dir.join(format!("{}.bin", file_id));
    let json_path = offline_dir.join(format!("{}.json", file_id));
    
    fs::write(&bin_path, file_data)?;
    
    let meta = json!({
        "file_name": file_name,
        "source_path": source_path,
        "file_size": file_size
    });
    fs::write(&json_path, serde_json::to_string(&meta)?)?;
    Ok(())
}

#[cfg(windows)]
async fn process_offline_usb_files(config: Arc<Config>, sync_manager: Arc<SyncManager>) {
    use std::fs;
    use std::path::Path;
    use reqwest::multipart;
    
    let offline_dir = Path::new("C:\\ProgramData\\RAV\\offline_usb_files");
    if !offline_dir.exists() {
        let _ = fs::create_dir_all(offline_dir);
    }

    let mut interval_timer = tokio::time::interval(std::time::Duration::from_secs(60));
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .connect_timeout(std::time::Duration::from_secs(30))
        .build().unwrap_or_default();
        
    loop {
        interval_timer.tick().await;
        
        if let Ok(entries) = fs::read_dir(offline_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map_or(false, |ext| ext == "json") {
                    if let Some(file_id) = path.file_stem().and_then(|n| n.to_str()) {
                        let bin_path = offline_dir.join(format!("{}.bin", file_id));
                        if !bin_path.exists() {
                            let _ = fs::remove_file(&path); // orphan meta
                            continue;
                        }
                        
                        // Load metadata
                        if let Ok(meta_str) = fs::read_to_string(&path) {
                            if let Ok(meta) = serde_json::from_str::<serde_json::Value>(&meta_str) {
                                let file_name = meta["file_name"].as_str().unwrap_or("unknown");
                                let source_path = meta["source_path"].as_str().unwrap_or("unknown");
                                let file_size = meta["file_size"].as_u64().unwrap_or(0);
                                
                                if let Ok(file_data) = fs::read(&bin_path) {
                                    let url = format!("{}/api/v1/files/upload", config.backend.url);
                                    let (agent_id, _) = sync_manager.get_identity().await;
                                    
                                    let form = multipart::Form::new()
                                        .text("file_id", file_id.to_string())
                                        .text("file_name", file_name.to_string())
                                        .text("agent_id", agent_id)
                                        .text("file_path", source_path.to_string())
                                        .text("file_size", file_size.to_string())
                                        .part("file", multipart::Part::bytes(file_data)
                                            .file_name(file_name.to_string())
                                            .mime_str("application/octet-stream").unwrap());
                                            
                                    let mut request = client.post(&url).multipart(form);
                                    if let Some(api_key) = &config.backend.api_key {
                                        request = request.header("X-API-Key", api_key);
                                    }
                                    
                                    if let Ok(response) = request.send().await {
                                        if response.status().is_success() {
                                            tracing::info!("Recovered offline USB file: {}", file_id);
                                            let _ = fs::remove_file(&path);
                                            let _ = fs::remove_file(&bin_path);
                                        }
                                    }
                                }
                            } else {
                                // Corrupt meta
                                let _ = fs::remove_file(&path);
                                let _ = fs::remove_file(&bin_path);
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(windows)]
async fn map_drives_to_devices(
    drive_letters: &std::collections::HashSet<String>,
) -> Result<std::collections::HashMap<String, (String, String)>> {
    use std::process::Command;
    use std::os::windows::process::CommandExt;
    
    let mut drive_map = std::collections::HashMap::new();
    
        // For each drive letter, find the associated USB device
        for drive_letter in drive_letters {
            // Alternative simpler method: Get USB device from drive
        let device_output = Command::new("powershell")
            .args(&[
                "-Command",
                &format!(
                    "$vol = Get-Volume -DriveLetter {}; \
                     $disk = Get-Disk -Number $vol.DiskNumber; \
                     Get-PnpDevice | Where-Object {{ $_.InstanceId -like \"*USB*\" -and $_.FriendlyName -like \"*$($disk.FriendlyName)*\" }} | Select-Object -First 1 -ExpandProperty InstanceId",
                    drive_letter.replace(":", "")
                )
            ])
            .creation_flags(0x08000000)
            .output();
        
        if let Ok(output) = device_output {
            let output_str = String::from_utf8_lossy(&output.stdout);
            let device_id = output_str.lines().next().unwrap_or("").trim().to_string();
            
            if !device_id.is_empty() && device_id.starts_with("USB\\") {
                // Get device name
                let name_output = Command::new("powershell")
                    .args(&[
                        "-Command",
                        &format!(
                            "Get-PnpDevice -InstanceId '{}' | Select-Object -ExpandProperty FriendlyName",
                            device_id
                        )
                    ])
                    .creation_flags(0x08000000)
                    .output();
                
                let device_name = if let Ok(name_out) = name_output {
                    String::from_utf8_lossy(&name_out.stdout).trim().to_string()
                } else {
                    format!("USB Device on {}", drive_letter)
                };
                
                drive_map.insert(drive_letter.clone(), (device_id, device_name));
            } else {
                // Fallback: use drive letter as identifier
                drive_map.insert(
                    drive_letter.clone(),
                    (format!("USB_DRIVE_{}", drive_letter.replace(":", "")), format!("USB Drive {}", drive_letter))
                );
            }
        } else {
            // Fallback: use drive letter as identifier
            drive_map.insert(
                drive_letter.clone(),
                (format!("USB_DRIVE_{}", drive_letter.replace(":", "")), format!("USB Drive {}", drive_letter))
            );
        }
    }
    
    Ok(drive_map)
}

#[cfg(target_os = "macos")]
async fn start_macos_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    // macOS implementation using IOKit
    info!("macOS USB monitoring not yet implemented");
    Ok(())
}

#[cfg(target_os = "linux")]
async fn start_linux_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    use tokio::sync::Mutex;
    use std::collections::HashSet;
    
    let known_devices: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    
    // Monitor udev events
    let mut udev_monitor = udev::MonitorBuilder::new()?
        .match_subsystem("usb")?
        .listen()?;

    loop {
        // This is a blocking call, so we'll need to handle it differently
        // For now, use a polling approach
        tokio::time::sleep(Duration::from_secs(2)).await;
        
        match detect_linux_usb_devices().await {
            Ok(current_devices) => {
                let mut known = known_devices.lock().await;
                
                for device_id in &current_devices {
                    if !known.contains(device_id) {
                        info!("USB device inserted: {}", device_id);
                        known.insert(device_id.clone());
                        
                        let (agent_id, _) = sync_manager.get_identity().await;
                        let event = Event {
                            event_type: "usb_inserted".to_string(),
                            timestamp: Utc::now(),
                            agent_id,
                            metadata: json!({
                                "device_id": device_id,
                                "platform": "linux"
                            }),
                        };
                        sync_manager.queue_event(event);
                    }
                }
            }
            Err(e) => {
                error!("Linux USB detection error: {}", e);
            }
        }
    }
}

#[cfg(target_os = "linux")]
async fn detect_linux_usb_devices() -> Result<std::collections::HashSet<String>> {
    use std::fs;
    use std::path::Path;
    
    let usb_path = Path::new("/sys/bus/usb/devices");
    let mut devices = std::collections::HashSet::new();
    
    if usb_path.exists() {
        for entry in fs::read_dir(usb_path)? {
            let entry = entry?;
            let path = entry.path();
            if let Some(id) = path.file_name().and_then(|n| n.to_str()) {
                devices.insert(id.to_string());
            }
        }
    }
    
    Ok(devices)
}

