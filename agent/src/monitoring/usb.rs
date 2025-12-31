use anyhow::Result;
use chrono::Utc;
use serde_json::json;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tracing::{error, info, warn};

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
    
    let known_devices: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    let mut interval = interval(Duration::from_secs(5));
    
    // Track USB drive letters for file monitoring
    let usb_drives: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
    
    // Map drive letters to USB device IDs (to tie transfers to specific devices)
    let drive_to_device: Arc<Mutex<std::collections::HashMap<String, (String, String)>>> = Arc::new(Mutex::new(std::collections::HashMap::new()));

    // Take initial snapshot of currently connected USB devices to avoid false positives
    // Only devices inserted/removed AFTER this point will be logged
    info!("Taking initial snapshot of connected USB devices (these will not be logged as insertions)...");
    match detect_usb_devices().await {
        Ok(initial_devices) => {
            let mut known = known_devices.lock().await;
            let _device_details = get_usb_device_details().await.unwrap_or_default();
            let initial_usb_drives = get_usb_drive_letters().await.unwrap_or_default();
            let initial_drive_map = map_drives_to_devices(&initial_usb_drives).await.unwrap_or_default();
            
            // Populate known_devices with all currently connected devices (without logging)
            for device_id in &initial_devices {
                known.insert(device_id.clone());
            }
            
            // Populate usb_drives and drive_to_device with currently connected drives
            {
                let mut drives = usb_drives.lock().await;
                let mut drive_map = drive_to_device.lock().await;
                
                for drive in &initial_usb_drives {
                    drives.insert(drive.clone());
                    if let Some((device_id, device_name)) = initial_drive_map.get(drive) {
                        drive_map.insert(drive.clone(), (device_id.clone(), device_name.clone()));
                    }
                }
            }
            
            info!("Initial snapshot complete: {} USB devices and {} USB drives detected (not logged as insertions)", 
                  initial_devices.len(), initial_usb_drives.len());
        }
        Err(e) => {
            warn!("Failed to take initial USB device snapshot: {}. Monitoring will start with empty state.", e);
        }
    }

    // Start file transfer monitoring task
    if config.monitoring.usb.track_file_transfers {
        let sync_manager_clone = sync_manager.clone();
        let config_clone = config.clone();
        let usb_drives_clone = usb_drives.clone();
        let drive_to_device_clone = drive_to_device.clone();
        
        tokio::spawn(async move {
            let mut file_check_interval = tokio::time::interval(Duration::from_secs(10));
            let mut last_file_snapshots: std::collections::HashMap<String, std::collections::HashMap<String, u64>> = std::collections::HashMap::new();
            let mut initial_snapshots_taken: std::collections::HashSet<String> = std::collections::HashSet::new();
            let mut system_file_snapshots: std::collections::HashMap<String, std::collections::HashMap<String, u64>> = std::collections::HashMap::new(); // Changed to HashMap to track sizes
            // Track recently removed system files (for matching with USB transfers)
            let mut recent_system_file_removals: std::collections::VecDeque<(String, String, u64, chrono::DateTime<chrono::Utc>)> = std::collections::VecDeque::new(); // (file_name, file_path, file_size, timestamp)
            // Track recently removed USB files (for matching with system transfers)
            let mut recent_usb_file_removals: std::collections::VecDeque<(String, String, u64, String, chrono::DateTime<chrono::Utc>)> = std::collections::VecDeque::new(); // (file_name, usb_path, file_size, device_id, timestamp)
            
            loop {
                file_check_interval.tick().await;
                
                let drives = usb_drives_clone.lock().await.clone();
                let device_map = drive_to_device_clone.lock().await.clone();
                
                // Get the most recently connected USB device for system file monitoring
                let (monitoring_device_id, monitoring_device_name) = if let Some((device_id, device_name)) = device_map.values().next() {
                    (device_id.clone(), device_name.clone())
                } else {
                    ("UNKNOWN_USB".to_string(), "Unknown USB Device".to_string())
                };
                
                for drive_letter in &drives {
                    let snapshot = last_file_snapshots.entry(drive_letter.clone()).or_insert_with(std::collections::HashMap::new);
                    
                    // Get device info for this drive
                    let (device_id, device_name) = device_map.get(drive_letter)
                        .cloned()
                        .unwrap_or_else(|| (drive_letter.clone(), format!("USB Drive {}", drive_letter)));
                    
                    // Take initial snapshot on first detection (don't log existing files)
                    if !initial_snapshots_taken.contains(drive_letter) {
                        if let Ok(initial_files) = take_initial_snapshot(drive_letter).await {
                            *snapshot = initial_files;
                            initial_snapshots_taken.insert(drive_letter.clone());
                            info!("Initial snapshot taken for drive {} - {} existing files (not logged)", drive_letter, snapshot.len());
                        }
                    }
                    
                    if let Err(e) = monitor_usb_file_transfers(
                        drive_letter,
                        &device_id,
                        &device_name,
                        snapshot,
                        &mut recent_system_file_removals,
                        &mut recent_usb_file_removals,
                        &sync_manager_clone,
                        &config_clone,
                    ).await {
                        error!("File transfer monitoring error for {}: {}", drive_letter, e);
                    }
                }
                
                // Monitor system directories for files copied FROM USB
                // Do this regardless of whether USB drives are currently connected
                // This catches files copied even if USB was removed after copying
                if let Err(e) = monitor_system_for_usb_files(
                    &monitoring_device_id,
                    &monitoring_device_name,
                    &mut system_file_snapshots,
                    &mut recent_usb_file_removals,
                    &mut recent_system_file_removals,
                    &sync_manager_clone,
                    &config_clone,
                ).await {
                    error!("System file monitoring error: {}", e);
                }
                
                // Clean up old removal records (older than 5 minutes)
                let cutoff_time = chrono::Utc::now() - chrono::Duration::minutes(5);
                recent_system_file_removals.retain(|(_, _, _, ts)| *ts > cutoff_time);
                recent_usb_file_removals.retain(|(_, _, _, _, ts)| *ts > cutoff_time);
                
                // Clean up snapshots for removed drives
                initial_snapshots_taken.retain(|d| drives.contains(d));
                last_file_snapshots.retain(|d, _| drives.contains(d));
            }
        });
    }

    loop {
        interval.tick().await;

        match detect_usb_devices().await {
            Ok(current_devices) => {
                let mut known = known_devices.lock().await;
                
                // Get device details for better identification (moved inside loop)
                let device_details = get_usb_device_details().await.unwrap_or_default();
                
                // Get USB drive letters and map them to devices
                let current_usb_drives = get_usb_drive_letters().await.unwrap_or_default();
                let drive_device_map = map_drives_to_devices(&current_usb_drives).await.unwrap_or_default();
                
                {
                    let mut drives = usb_drives.lock().await;
                    let mut drive_map = drive_to_device.lock().await;
                    
                    for drive in &current_usb_drives {
                        if !drives.contains(drive) {
                            info!("USB drive mounted: {}", drive);
                            drives.insert(drive.clone());
                            
                            // Map this drive to its USB device
                            if let Some((device_id, device_name)) = drive_device_map.get(drive) {
                                drive_map.insert(drive.clone(), (device_id.clone(), device_name.clone()));
                                info!("Mapped drive {} to USB device: {} ({})", drive, device_id, device_name);
                            }
                        }
                    }
                    // Remove drives that are no longer available
                    drives.retain(|d| current_usb_drives.contains(d));
                    drive_map.retain(|d, _| current_usb_drives.contains(d));
                }
                
                // Detect new devices
                for device_id in &current_devices {
                    if !known.contains(device_id) {
                        // Try to get friendly name from device details
                        let device_name = device_details.get(device_id)
                            .cloned()
                            .unwrap_or_else(|| "Unknown Device".to_string());
                        
                        info!("USB device inserted: {} ({})", device_id, device_name);
                        known.insert(device_id.clone());
                        
                        // Get drive letters for this device
                        let device_drives: Vec<String> = drive_device_map.iter()
                            .filter(|(_, (did, _))| did == device_id)
                            .map(|(drive, _)| drive.clone())
                            .collect();
                        
                        if device_name != "Unknown Device" {
                             let (agent_id, _) = sync_manager.get_identity().await;
                             let event = Event {
                                 event_type: "usb_inserted".to_string(),
                                 timestamp: Utc::now(),
                                 agent_id,
                                 category: "usb".to_string(),
                                 severity: "low".to_string(),
                                 metadata: json!({
                                     "device_id": device_id,
                                     "device_name": device_name,
                                     "platform": "windows",
                                     "drive_letters": device_drives
                                 }),
                             };
                             sync_manager.queue_event(event);
                        } else {
                            info!("Skipping event for Unknown Device: {}", device_id);
                        }
                    }
                }

                // Detect removed devices
                let removed: Vec<String> = known.difference(&current_devices).cloned().collect();
                for device_id in removed {
                    // Try to get friendly name before removal
                    let device_name = device_details.get(&device_id)
                        .cloned()
                        .unwrap_or_else(|| "Unknown Device".to_string());
                    
                    info!("USB device removed: {} ({})", device_id, device_name);
                    known.remove(&device_id);
                    
                    if device_name != "Unknown Device" {
                        let (agent_id, _) = sync_manager.get_identity().await;
                        let event = Event {
                            event_type: "usb_removed".to_string(),
                            timestamp: Utc::now(),
                            agent_id,
                            category: "usb".to_string(),
                            severity: "low".to_string(),
                            metadata: json!({
                                "device_id": device_id,
                                "device_name": device_name,
                                "platform": "windows"
                            }),
                        };
                        sync_manager.queue_event(event);
                    } else {
                        info!("Skipping event for Unknown Device: {}", device_id);
                    }
                }
                
                // Log current device count for debugging (only if there's a change)
                if current_devices.len() != known.len() {
                    info!("USB monitoring: {} current devices detected, {} known devices tracked", current_devices.len(), known.len());
                }
            }
            Err(e) => {
                error!("USB device detection error: {}", e);
            }
        }
    }
}

#[cfg(windows)]
async fn detect_usb_devices() -> Result<std::collections::HashSet<String>> {
    use std::process::Command;
    
    // Query multiple sources to catch all USB devices:
    // 1. PnP USB devices (controllers, hubs, etc.)
    // 2. Removable storage devices (flash drives, external drives)
    // 3. USB-connected devices via WMI
    
    let mut device_set = std::collections::HashSet::new();
    
    // Method 1: Get PnP USB devices
    let pnp_output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-PnpDevice -Class USB -Status OK | Select-Object -ExpandProperty InstanceId | Where-Object { $_ -ne $null }"
        ])
        .output();
    
    if let Ok(output) = pnp_output {
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            let line = line.trim();
            if !line.is_empty() && !line.starts_with("InstanceId") && !line.starts_with("---") {
                device_set.insert(line.to_string());
            }
        }
    }
    
    // Method 2: Get removable storage devices (flash drives, external drives)
    let disk_output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-Disk | Where-Object { $_.BusType -eq 'USB' -or $_.BusType -eq 'SD' } | ForEach-Object { $_.Path }"
        ])
        .output();
    
    if let Ok(output) = disk_output {
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            let line = line.trim();
            if !line.is_empty() {
                // Extract device ID from path if possible
                if let Some(device_id) = extract_device_id_from_path(line) {
                    device_set.insert(device_id);
                }
            }
        }
    }
    
    // Method 3: Get USB devices via WMI (more comprehensive)
    let wmi_output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-WmiObject Win32_USBControllerDevice | ForEach-Object { [wmi]$_.Dependent } | Select-Object -ExpandProperty PNPDeviceID | Where-Object { $_ -ne $null }"
        ])
        .output();
    
    if let Ok(output) = wmi_output {
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            let line = line.trim();
            if !line.is_empty() && line.starts_with("USB\\") {
                device_set.insert(line.to_string());
            }
        }
    }
    
    // Method 4: Get logical drives on USB devices
    let logical_output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 -or ($_.DriveType -eq 3 -and $_.MediaType -eq 11) } | ForEach-Object { $_.DeviceID }"
        ])
        .output();
    
    if let Ok(output) = logical_output {
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            let line = line.trim();
            if !line.is_empty() && line.len() == 2 && line.ends_with(":") {
                // Try to get the USB device ID for this drive
                let device_id = format!("USB_DRIVE_{}", line.replace(":", ""));
                device_set.insert(device_id);
            }
        }
    }

    Ok(device_set)
}

#[cfg(windows)]
fn extract_device_id_from_path(path: &str) -> Option<String> {
    // Try to extract a meaningful device identifier from the path
    // Paths usually contain device IDs
    if path.contains("USBSTOR") {
        // Extract from USB storage path
        if let Some(start) = path.find("USBSTOR\\") {
            if let Some(end) = path[start..].find("&") {
                return Some(path[start..start+end].to_string());
            }
        }
    }
    None
}

#[cfg(windows)]
async fn get_usb_device_details() -> Result<std::collections::HashMap<String, String>> {
    use std::process::Command;
    
    let mut device_map = std::collections::HashMap::new();
    
    // Get device friendly names using PowerShell
    let output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-PnpDevice -Class USB -Status OK | Select-Object InstanceId, FriendlyName | ConvertTo-Json"
        ])
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
                            format!("USB Drive {}", device_id)
                        } else {
                            format!("{} ({})", volume_name, device_id)
                        };
                        device_map.insert(key, name);
                    }
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
    use std::fs;
    use std::path::Path;

    // SECURITY: Validate drive letter to prevent Path Traversal
    if !is_safe_drive_letter(drive_letter) {
        // Log warning but don't error out the whole flow, just return empty snapshot
        tracing::warn!("Security Warning: Invalid drive letter detected: {}", drive_letter);
        return Ok(std::collections::HashMap::new());
    }
    
    let drive_path = format!("{}", drive_letter);
    let path = Path::new(&drive_path);
    let mut snapshot = std::collections::HashMap::new();
    
    if path.exists() {
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_file() {
                    if let Ok(metadata) = fs::metadata(&entry_path) {
                        let full_path = entry_path.to_string_lossy().to_string();
                        let file_size = metadata.len();
                        snapshot.insert(full_path, file_size);
                    }
                }
            }
        }
    }
    
    Ok(snapshot)
}

#[cfg(windows)]
async fn monitor_system_for_usb_files(
    device_id: &str,
    device_name: &str,
    system_snapshots: &mut std::collections::HashMap<String, std::collections::HashMap<String, u64>>,
    recent_usb_removals: &mut std::collections::VecDeque<(String, String, u64, String, chrono::DateTime<chrono::Utc>)>,
    recent_system_removals: &mut std::collections::VecDeque<(String, String, u64, chrono::DateTime<chrono::Utc>)>,
    sync_manager: &SyncManager,
    config: &Config,
) -> Result<()> {
    use std::fs;
    use std::path::Path;
    use std::time::SystemTime;
    
    // Monitor common system directories where files are typically copied FROM USB
    let system_dirs = vec![
        std::env::var("USERPROFILE").unwrap_or_default() + "\\Downloads",
        std::env::var("USERPROFILE").unwrap_or_default() + "\\Desktop",
        std::env::var("USERPROFILE").unwrap_or_default() + "\\Documents",
    ];
    
    let now = SystemTime::now();
    
    for system_dir in system_dirs {
        let sys_path = Path::new(&system_dir);
        if !sys_path.exists() {
            continue;
        }
        
        let snapshot = system_snapshots.entry(system_dir.clone()).or_insert_with(std::collections::HashMap::new);
        let mut current_files: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
        
        if let Ok(entries) = fs::read_dir(sys_path) {
            for entry in entries.flatten() {
                let entry_path = entry.path();
                if entry_path.is_file() {
                    if let Ok(metadata) = fs::metadata(&entry_path) {
                        let file_path = entry_path.to_string_lossy().to_string();
                        let file_size = metadata.len();
                        current_files.insert(file_path.clone(), file_size);
                        
                        // Check if file is new (not in snapshot) - this indicates it was recently copied
                        if !snapshot.contains_key(&file_path) {
                            // Check if file was recently created/modified (within last 120 seconds)
                            let is_recent = if let Ok(modified_time) = metadata.modified() {
                                if let Ok(duration) = now.duration_since(modified_time) {
                                    duration.as_secs() < 120
                                } else {
                                    false
                                }
                            } else {
                                false
                            };
                            
                            // Also check creation time if available
                            let is_newly_created = if let Ok(created_time) = metadata.created() {
                                if let Ok(duration) = now.duration_since(created_time) {
                                    duration.as_secs() < 120
                                } else {
                                    false
                                }
                            } else {
                                false
                            };
                            
                            if is_recent || is_newly_created {
                                // New file in system directory - likely copied FROM USB TO SYSTEM
                                let file_name = entry_path.file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("Unknown")
                                    .to_string();
                                
                                // Try to find source USB path from recent USB file removals
                                let source_usb_path = find_matching_usb_source_path(&file_name, file_size, recent_usb_removals);
                                
                                info!("Detected file copied FROM USB to system: {} ({} bytes) from {}", 
                                      file_path, file_size, 
                                      source_usb_path.as_ref().map(|s| s.as_str()).unwrap_or("unknown USB location"));
                                
                                log_file_transfer(
                                    &file_path,
                                    file_size,
                                    "from_usb_to_system",
                                    "", // No drive letter for system files
                                    device_id,
                                    device_name,
                                    source_usb_path.as_deref(),
                                    None,
                                    sync_manager,
                                    config,
                                ).await?;
                            }
                        } else {
                            // File exists in snapshot - check if it was removed and re-added (modified)
                            if let Some(&old_size) = snapshot.get(&file_path) {
                                if old_size != file_size {
                                    // File was modified - might be a re-copy
                                    let file_name = entry_path.file_name()
                                        .and_then(|n| n.to_str())
                                        .unwrap_or("Unknown")
                                        .to_string();
                                    let source_usb_path = find_matching_usb_source_path(&file_name, file_size, recent_usb_removals);
                                    
                                    log_file_transfer(
                                        &file_path,
                                        file_size,
                                        "from_usb_to_system",
                                        "",
                                        device_id,
                                        device_name,
                                        source_usb_path.as_deref(),
                                        None,
                                        sync_manager,
                                        config,
                                    ).await?;
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Check for files that were removed from system directories (might have been copied to USB)
        for (file_path, &old_size) in snapshot.iter() {
            if !current_files.contains_key(file_path) {
                // File was removed from system directory
                let file_name = std::path::Path::new(file_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Unknown")
                    .to_string();
                
                // Record this removal for matching with USB file appearances
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
    // Look for a recently removed file with matching name and size
    // Prefer exact matches, then size matches
    for (removed_name, removed_path, removed_size, _) in recent_removals.iter().rev() {
        if removed_name == file_name && *removed_size == file_size {
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

// Helper function to find matching USB source path from USB file removals
#[cfg(windows)]
fn find_matching_usb_source_path(
    file_name: &str,
    file_size: u64,
    recent_removals: &std::collections::VecDeque<(String, String, u64, String, chrono::DateTime<chrono::Utc>)>,
) -> Option<String> {
    // Look for a recently removed USB file with matching name and size
    for (removed_name, removed_path, removed_size, _, _) in recent_removals.iter().rev() {
        if removed_name == file_name && *removed_size == file_size {
            return Some(removed_path.clone());
        }
    }
    // If no exact match, try size-only match
    for (_, removed_path, removed_size, _, _) in recent_removals.iter().rev() {
        if *removed_size == file_size {
            return Some(removed_path.clone());
        }
    }
    None
}

#[cfg(windows)]
async fn get_usb_drive_letters() -> Result<std::collections::HashSet<String>> {
    use std::process::Command;
    
    let mut drive_set = std::collections::HashSet::new();
    
    // Get removable drives
    let output = Command::new("powershell")
        .args(&[
            "-Command",
            "Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 2 } | Select-Object -ExpandProperty DeviceID"
        ])
        .output();
    
    if let Ok(output) = output {
        let output_str = String::from_utf8_lossy(&output.stdout);
        for line in output_str.lines() {
            let line = line.trim();
            if !line.is_empty() && line.len() == 2 && line.ends_with(":") {
                drive_set.insert(line.to_string());
            }
        }
    }
    
    Ok(drive_set)
}

#[cfg(windows)]
async fn monitor_usb_file_transfers(
    drive_letter: &str,
    device_id: &str,
    device_name: &str,
    last_snapshot: &mut std::collections::HashMap<String, u64>,
    recent_system_removals: &mut std::collections::VecDeque<(String, String, u64, chrono::DateTime<chrono::Utc>)>,
    recent_usb_removals: &mut std::collections::VecDeque<(String, String, u64, String, chrono::DateTime<chrono::Utc>)>,
    sync_manager: &SyncManager,
    config: &Config,
) -> Result<()> {
    use std::fs;
    use std::path::Path;
    
    // SECURITY: Validate drive letter to prevent Path Traversal
    if !is_safe_drive_letter(drive_letter) {
        tracing::warn!("Security Warning: Invalid drive letter in monitor task: {}", drive_letter);
        return Ok(());
    }

    // Get current files on USB drive
    let drive_path = format!("{}", drive_letter);
    let path = Path::new(&drive_path);
    
    if !path.exists() {
        return Ok(()); // Drive not available
    }
    
    let mut current_files: std::collections::HashMap<String, u64> = std::collections::HashMap::new();
    
    // Recursively get all files (simplified - only top level for now)
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_file() {
                if let Ok(metadata) = fs::metadata(&entry_path) {
                    let full_path = entry_path.to_string_lossy().to_string();
                    let file_size = metadata.len();
                    current_files.insert(full_path.clone(), file_size);
                    
                    // Extract file name for matching
                    let file_name = entry_path.file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string();
                    
                    // Only log if this is a NEW file (not in snapshot) or MODIFIED file
                    // Existing files are already in the snapshot and won't be logged
                    if let Some(&old_size) = last_snapshot.get(&full_path) {
                        if old_size != file_size {
                            // File was modified after initial snapshot
                            // Try to find source path from recent system file removals
                            let source_path = find_matching_source_path(&file_name, file_size, recent_system_removals);
                            log_file_transfer(
                                &full_path,
                                file_size,
                                "to_usb",
                                drive_letter,
                                device_id,
                                device_name,
                                source_path.as_deref(),
                                None,
                                sync_manager,
                                config,
                            ).await?;
                        }
                    } else {
                        // New file - copied TO USB (not in initial snapshot)
                        // Try to find source path from recent system file removals
                        let source_path = find_matching_source_path(&file_name, file_size, recent_system_removals);
                        log_file_transfer(
                            &full_path,
                            file_size,
                            "to_usb",
                            drive_letter,
                            device_id,
                            device_name,
                            source_path.as_deref(),
                            None,
                            sync_manager,
                            config,
                        ).await?;
                    }
                }
            }
        }
    }
    
    // Check for files that were removed (copied FROM USB)
    for (file_path, &old_size) in last_snapshot.iter() {
        if !current_files.contains_key(file_path) && file_path.starts_with(&drive_path) {
            // File was removed from USB (likely copied to system)
            // Extract file name from path
            let file_name = std::path::Path::new(file_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Unknown")
                .to_string();
            
            // Record this removal for matching with system file appearances
            recent_usb_removals.push_back((
                file_name.clone(),
                file_path.clone(),
                old_size,
                device_id.to_string(),
                chrono::Utc::now(),
            ));
            
            log_file_transfer(
                file_path,
                old_size,
                "from_usb",
                drive_letter,
                device_id,
                device_name,
                None,
                None,
                sync_manager,
                config,
            ).await?;
        }
    }
    
    // Update snapshot
    *last_snapshot = current_files;
    
    Ok(())
}

#[cfg(windows)]
async fn log_file_transfer(
    file_path: &str,
    file_size: u64,
    direction: &str,
    drive_letter: &str,
    device_id: &str,
    device_name: &str,
    source_path: Option<&str>, // Source path (for to_usb: system path, for from_usb_to_system: USB path)
    destination_path: Option<&str>, // Destination path (currently not used, reserved for future)
    sync_manager: &SyncManager,
    config: &Config,
) -> Result<()> {
    use std::path::Path;
    
    let path = Path::new(file_path);
    let file_name = path.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string();
    
    info!("USB file transfer detected: {} {} ({}) on device {} ({})", 
          direction, file_name, file_path, device_id, device_name);
    
    // Backup the file if it exists and is accessible
    // For large files (>10MB), skip backup to avoid connection timeouts
    let backup_file_id = if path.exists() && file_size > 0 && file_size < 10 * 1024 * 1024 {
        // Only backup files under 10MB to avoid connection timeouts and storage issues
        // Backup files copied TO USB (source is on system)
        // Backup files copied FROM USB TO SYSTEM (destination is on system)
        if direction == "to_usb" || direction == "from_usb_to_system" {
            match backup_and_upload_file(file_path, &file_name, file_size, sync_manager, config).await {
                Ok(backup_id) => {
                    info!("File backed up and uploaded successfully: {}", backup_id);
                    Some(backup_id)
                }
                Err(e) => {
                    // Log error but don't fail the event logging
                    let error_msg = format!("{}", e);
                    if error_msg.contains("10053") || error_msg.contains("connection") || error_msg.contains("timeout") {
                        warn!("File too large or connection issue, skipping backup for {} ({} bytes): {}", file_name, file_size, error_msg);
                    } else {
                        error!("Failed to backup file {}: {}", file_path, e);
                    }
                    None
                }
            }
        } else {
            None // Files FROM USB (removed from USB) can't be backed up (original is on USB)
        }
    } else if file_size >= 10 * 1024 * 1024 {
        // File is too large for backup
        info!("File {} is too large ({} bytes), skipping backup", file_name, file_size);
        None
    } else {
        None
    };
    
    let mut metadata = json!({
        "file_name": file_name,
        "file_path": file_path,
        "file_size": file_size,
        "direction": direction,
        "drive_letter": drive_letter,
        "device_id": device_id,
        "device_name": device_name,
        "platform": "windows",
        "backup_file_id": backup_file_id
    });
    
    // Add source path if available
    if let Some(src) = source_path {
        metadata["source_path"] = json!(src);
    }
    
    // Add destination path if available
    if let Some(dst) = destination_path {
        metadata["destination_path"] = json!(dst);
    }
    
    let (agent_id, _) = sync_manager.get_identity().await;
    let event = Event {
        event_type: "usb_file_transfer".to_string(),
        timestamp: Utc::now(),
        agent_id,
        category: "usb".to_string(),
        severity: "medium".to_string(),
        metadata,
    };
    
    sync_manager.queue_event(event);
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
    
    // Create multipart form
    let form = multipart::Form::new()
        .text("file_id", file_id.clone())
        .text("file_name", file_name.to_string())
        .text("agent_id", agent_id)
        .text("file_path", source_path.to_string())
        .text("file_size", file_size.to_string())
        .part("file", multipart::Part::bytes(file_data)
            .file_name(file_name.to_string())
            .mime_str("application/octet-stream")?);
    
    let mut request = client.post(&url).multipart(form);
    
    if let Some(api_key) = &config.backend.api_key {
        request = request.header("X-API-Key", api_key);
    }
    
    let response = request.send().await?;
    
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        anyhow::bail!("Backend returned error {}: {}", status, body);
    }
    
    info!("File uploaded to backend: {} ({} bytes)", file_id, file_size);
    
    Ok(file_id)
}

#[cfg(windows)]
async fn map_drives_to_devices(
    drive_letters: &std::collections::HashSet<String>,
) -> Result<std::collections::HashMap<String, (String, String)>> {
    use std::process::Command;
    
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
                            category: "usb".to_string(),
                            severity: "low".to_string(),
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

