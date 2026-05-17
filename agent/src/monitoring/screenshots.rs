use anyhow::Result;
use chrono::Utc;
use serde_json::json;
use std::sync::Arc;
use tokio::time::{interval, Duration};
use tracing::{error, info};

use crate::config::Config;
use crate::sync::{Event, SyncManager};

pub async fn start_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    info!("Screenshot monitoring check: enabled={}", config.monitoring.screenshots.enabled);
    if !config.monitoring.screenshots.enabled {
        info!("Screenshot monitoring is disabled");
        return Ok(());
    }

    info!("Starting screenshot monitoring");

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
    use sha2::{Sha256, Digest};

    let capture_interval = Duration::from_secs(config.monitoring.screenshots.capture_interval_seconds);
    let mut interval_timer = interval(capture_interval);

    info!(
        "Screenshot monitoring started: interval={}s, format={}, quality={}",
        config.monitoring.screenshots.capture_interval_seconds,
        config.monitoring.screenshots.format,
        config.monitoring.screenshots.compression_quality
    );

    // Local directory for ALL screenshots (forensic storage)
    let screenshot_dir = std::path::Path::new("C:\\ProgramData\\RAV\\screenshots");
    let _ = std::fs::create_dir_all(screenshot_dir);

    // Start background recovery task
    let config_clone = config.clone();
    let sync_manager_clone = sync_manager.clone();
    tokio::spawn(async move {
        process_screenshot_queue(config_clone, sync_manager_clone).await;
    });

    let mut last_image_hash = String::new();

    loop {
        interval_timer.tick().await;

        // Capture screenshot
        match capture_windows_screenshot(&config).await {
            Ok((image_data, width, height)) => {
                // Compute hash to detect identical frames
                let mut data_hasher = Sha256::new();
                data_hasher.update(&image_data);
                let current_image_hash = format!("{:x}", data_hasher.finalize());
                
                if current_image_hash == last_image_hash {
                    continue;
                }
                last_image_hash = current_image_hash.clone();
                
                let captured_at = Utc::now();
                let file_id = format!("ss_{}_{}", captured_at.format("%Y%m%d_%H%M%S"), &current_image_hash[..12]);
                let ext = if config.monitoring.screenshots.format == "png" { "png" } else { "jpg" };
                let file_name = format!("{}.{}", file_id, ext);
                let local_path = screenshot_dir.join(&file_name);

                // 1. SAVE IMMEDIATELY to local disk (Forensic Persistence)
                if let Err(e) = std::fs::write(&local_path, &image_data) {
                    error!("CRITICAL: Failed to save screenshot to disk: {}", e);
                    continue;
                }

                // 2. QUEUE EVENT IMMEDIATELY (Forensic Record)
                let (agent_id, _) = sync_manager.get_identity().await;
                sync_manager.queue_event(Event {
                    event_type: "screenshot_captured".to_string(),
                    timestamp: captured_at,
                    agent_id,
                    metadata: json!({
                        "file_id": file_id,
                        "file_name": file_name,
                        "width": width,
                        "height": height,
                        "file_size": image_data.len(),
                        "format": config.monitoring.screenshots.format,
                        "platform": "windows",
                        "storage_path": local_path.to_string_lossy(),
                        "sync_status": "pending_upload"
                    }),
                });

                info!("Screenshot captured and persisted: {} ({} bytes)", file_id, image_data.len());
                
                // 3. ATTEMPT IMMEDIATE UPLOAD (Optional, background task will catch it if this fails)
                let sm_clone = sync_manager.clone();
                let cfg_clone = config.clone();
                let f_id = file_id.clone();
                let img_data = image_data.to_vec();
                tokio::spawn(async move {
                    if let Ok(_) = upload_screenshot(&f_id, &img_data, width, height, &cfg_clone, &sm_clone).await {
                        info!("Screenshot uploaded immediately: {}", f_id);
                        // We could emit a "sync success" event here, but the backend handles reconciliation
                    }
                });
            }
            Err(e) => {
                error!("Failed to capture screenshot: {}", e);
            }
        }
    }
}

#[cfg(windows)]
async fn process_screenshot_queue(config: Arc<Config>, sync_manager: Arc<SyncManager>) {
    use std::fs;
    let screenshot_dir = std::path::Path::new("C:\\ProgramData\\RAV\\screenshots");
    
    let mut interval_timer = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval_timer.tick().await;
        
        if let Ok(entries) = fs::read_dir(screenshot_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() { continue; }
                
                // Logic: if it's older than 1 minute, try to upload (if not already handled)
                // For simplicity, we try all files in the folder. 
                // A better way would be checking a 'sent' flag in SQLite, but checking the folder is robust.
                
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    let file_id = file_name.split('.').next().unwrap_or("unknown");
                    
                    if let Ok(image_data) = fs::read(&path) {
                        if let Ok(img) = image::load_from_memory(&image_data) {
                            match upload_screenshot(file_id, &image_data, img.width(), img.height(), &config, &sync_manager).await {
                                Ok(_) => {
                                    // In a production agent, we might move to an 'uploaded' folder or keep for N days.
                                    // For now, we leave it to avoid re-uploading if the backend is slow.
                                    // Wait, if we leave it, the next loop will try again. 
                                    // We should move it to a 'sent' subfolder.
                                    let sent_dir = screenshot_dir.join("sent");
                                    let _ = fs::create_dir_all(&sent_dir);
                                    let _ = fs::rename(&path, sent_dir.join(file_name));
                                    info!("Background upload success for screenshot: {}", file_id);
                                }
                                Err(_) => {
                                    // Still offline, will retry next cycle
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Check if the user has been idle for more than `threshold_secs` seconds.
/// Uses Windows GetLastInputInfo API. Returns false in service/Session 0 mode
/// (since there's no user input to measure — the helper handles that).
#[cfg(windows)]
fn is_user_idle(threshold_secs: u32) -> bool {
    use std::mem;
    
    #[repr(C)]
    struct LASTINPUTINFO {
        cb_size: u32,
        dw_time: u32,
    }
    
    extern "system" {
        fn GetLastInputInfo(plii: *mut LASTINPUTINFO) -> i32;
        fn GetTickCount() -> u32;
    }
    
    unsafe {
        let mut lii = LASTINPUTINFO {
            cb_size: mem::size_of::<LASTINPUTINFO>() as u32,
            dw_time: 0,
        };
        if GetLastInputInfo(&mut lii) == 0 {
            // API call failed (likely Session 0 / service mode) — don't skip
            return false;
        }
        let now = GetTickCount();
        let idle_ms = now.wrapping_sub(lii.dw_time);
        idle_ms > threshold_secs * 1000
    }
}

#[cfg(windows)]
async fn capture_windows_screenshot(config: &Config) -> Result<(Vec<u8>, u32, u32)> {
    use std::sync::atomic::{AtomicBool, Ordering};
    
    // Static flag to track if we're in service mode
    static SERVICE_MODE_DETECTED: AtomicBool = AtomicBool::new(false);
    
    // If we know we're in service mode, skip direct capture and use helper folder
    if SERVICE_MODE_DETECTED.load(Ordering::Relaxed) {
        return read_from_helper_folder(config).await;
    }
    
    // Try direct capture (works in console mode or interactive sessions)
    let direct_result = try_direct_capture(config).await;
    
    match direct_result {
        Ok(result) => Ok(result),
        Err(e) => {
            let error_msg = format!("{}", e);
            if error_msg.contains("Access is denied") || error_msg.contains("0x80070005") {
                // We're in Session 0 (service mode) - switch to helper folder
                SERVICE_MODE_DETECTED.store(true, Ordering::Relaxed);
                info!("Service mode detected - switching to helper-based screenshots");
                info!("Ensure rav-agent.exe --screenshot-helper is running in user session");
                
                // Try reading from helper folder
                read_from_helper_folder(config).await
            } else {
                Err(e)
            }
        }
    }
}

/// Read the latest screenshot from the helper folder and DELETE it after reading
/// so it is never re-read as a stale frame.
#[cfg(windows)]
async fn read_from_helper_folder(config: &Config) -> Result<(Vec<u8>, u32, u32)> {
    use std::fs;
    use std::path::Path;
    
    let helper_folder = Path::new("C:\\ProgramData\\RAV\\helper_screenshots");
    
    if !helper_folder.exists() {
        anyhow::bail!("Helper folder not found - ensure screenshot helper is running");
    }
    
    // Find the newest screenshot file
    let entries = fs::read_dir(helper_folder)?;
    let mut files: Vec<_> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "png"))
        .collect();
    
    if files.is_empty() {
        anyhow::bail!("No screenshots in helper folder - helper may not be running or idle");
    }
    
    // Sort by modification time (newest first)
    files.sort_by(|a, b| {
        let a_time = a.metadata().and_then(|m| m.modified()).ok();
        let b_time = b.metadata().and_then(|m| m.modified()).ok();
        b_time.cmp(&a_time)
    });
    
    let newest_file = &files[0];
    let filepath = newest_file.path();
    
    // Check if file is recent enough (within last 2 minutes)
    if let Ok(metadata) = newest_file.metadata() {
        if let Ok(modified) = metadata.modified() {
            let age = std::time::SystemTime::now().duration_since(modified).unwrap_or_default();
            if age > std::time::Duration::from_secs(120) {
                anyhow::bail!("Helper screenshot is stale ({}s old) - user likely idle", age.as_secs());
            }
        }
    }
    
    info!("Reading screenshot from helper: {:?}", filepath.file_name().unwrap_or_default());
    
    // Read the file
    let image_data = fs::read(&filepath)?;
    
    // DELETE the file after reading so we never re-read it as stale
    let _ = fs::remove_file(&filepath);
    // Also clean up any older files
    for old_file in files.iter().skip(1) {
        let _ = fs::remove_file(old_file.path());
    }
    
    // Decode to get dimensions
    let img = image::load_from_memory(&image_data)?;
    let width = img.width();
    let height = img.height();
    
    // Convert to JPEG if configured
    let final_data = if config.monitoring.screenshots.format == "jpeg" {
        let rgb_img = img.to_rgb8();
        let (jpeg_width, jpeg_height) = rgb_img.dimensions();
        let rgb_bytes = rgb_img.into_raw();
        let mut jpeg_data = Vec::new();
        {
            use image::codecs::jpeg::JpegEncoder;
            let mut encoder = JpegEncoder::new_with_quality(
                &mut jpeg_data,
                config.monitoring.screenshots.compression_quality,
            );
            encoder.encode(
                &rgb_bytes,
                jpeg_width,
                jpeg_height,
                image::ColorType::Rgb8,
            )?;
        }
        jpeg_data
    } else {
        image_data
    };

    Ok((final_data, width, height))
}

#[cfg(windows)]
async fn try_direct_capture(config: &Config) -> Result<(Vec<u8>, u32, u32)> {
    use screenshots::Screen;
    
    // Get all screens
    let screens = Screen::all()?;
    if screens.is_empty() {
        anyhow::bail!("No screens found");
    }

    // Capture primary screen (first screen)
    let screen = &screens[0];
    let image = screen.capture()?;
    let width = image.width() as u32;
    let height = image.height() as u32;

    // In screenshots 0.8, Image has a save() method, but we need bytes
    // Save to a temporary file and read it back, or convert directly
    // Let's use the save method to a temp file, then read bytes
    let temp_path = std::env::temp_dir().join(format!(
        "rav_screenshot_{}.png",
        chrono::Utc::now().timestamp_millis()
    ));
    
    // Save screenshot to temp file
    image.save(&temp_path)?;
    
    // Read the file bytes
    let image_data = std::fs::read(&temp_path)?;
    
    // Clean up temp file
    let _ = std::fs::remove_file(&temp_path);
    
    // If format is JPEG, we need to convert PNG to JPEG
    let final_data = if config.monitoring.screenshots.format == "jpeg" {
        // Decode PNG and re-encode as JPEG
        let img = image::load_from_memory(&image_data)?;
        let rgb_img = img.to_rgb8();
        let (jpeg_width, jpeg_height) = rgb_img.dimensions();
        let rgb_bytes = rgb_img.into_raw();
        let mut jpeg_data = Vec::new();
        {
            use image::codecs::jpeg::JpegEncoder;
            let mut encoder = JpegEncoder::new_with_quality(
                &mut jpeg_data,
                config.monitoring.screenshots.compression_quality,
            );
            encoder.encode(
                &rgb_bytes,
                jpeg_width,
                jpeg_height,
                image::ColorType::Rgb8,
            )?;
        }
        jpeg_data
    } else {
        // Keep as PNG
        image_data
    };

    Ok((final_data, width, height))
}

/// Capture screenshot via helper process running in user session
/// This is used when direct capture fails (e.g., running as a service in Session 0)
#[cfg(windows)]
async fn capture_via_helper() -> Result<(Vec<u8>, u32, u32)> {
    use std::process::Command;
    
    // Path to our own executable
    let exe_path = std::env::current_exe()?;
    
    // Temp file path for screenshot output
    let output_path = std::path::Path::new("C:\\ProgramData\\RAV\\screenshot_helper_output.png");
    
    // Ensure parent directory exists
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    
    // Remove old output file if exists
    let _ = std::fs::remove_file(output_path);
    
    // Method 1: Try using schtasks to run as currently logged-in user
    // Create a scheduled task that runs immediately
    let task_name = "RAVScreenshotCapture";
    
    // Build the helper command - it will capture and save to the output path
    let helper_cmd = format!(
        "\"{}\" --screenshot-helper --output \"{}\"",
        exe_path.display(),
        output_path.display()
    );
    
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // Create scheduled task that runs as the current user interactively
    let create_result = Command::new("schtasks")
        .args(&[
            "/Create",
            "/TN", task_name,
            "/TR", &helper_cmd,
            "/SC", "ONCE",
            "/ST", "00:00",
            "/F",  // Force overwrite
            "/RL", "HIGHEST",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    
    if let Err(e) = create_result {
        tracing::warn!("Failed to create screenshot task: {}", e);
        anyhow::bail!("Screenshot capture not available in service mode - please run agent interactively or install screenshot helper");
    }
    
    // Run the task immediately
    let run_result = Command::new("schtasks")
        .args(&["/Run", "/TN", task_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    
    if let Err(e) = run_result {
        let _ = Command::new("schtasks").args(&["/Delete", "/TN", task_name, "/F"]).creation_flags(CREATE_NO_WINDOW).output();
        anyhow::bail!("Failed to run screenshot task: {}", e);
    }
    
    // Wait for the output file to appear (up to 10 seconds)
    let mut attempts = 0;
    while attempts < 20 {
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
        if output_path.exists() {
            let metadata = std::fs::metadata(output_path)?;
            if metadata.len() > 0 {
                break;
            }
        }
        attempts += 1;
    }
    
    // Clean up the scheduled task
    let _ = Command::new("schtasks").args(&["/Delete", "/TN", task_name, "/F"]).creation_flags(CREATE_NO_WINDOW).output();
    
    // Read the output file
    if !output_path.exists() {
        anyhow::bail!("Screenshot helper did not produce output - capture may have failed");
    }
    
    let image_data = std::fs::read(output_path)?;
    let _ = std::fs::remove_file(output_path);
    
    // Decode to get dimensions
    let img = image::load_from_memory(&image_data)?;
    let width = img.width();
    let height = img.height();
    
    Ok((image_data, width, height))
}

#[cfg(windows)]
async fn upload_screenshot(
    file_id: &str,
    image_data: &[u8],
    _width: u32,
    _height: u32,
    config: &Config,
    _sync_manager: &SyncManager,
) -> Result<String> {
    use reqwest::multipart;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60)) // 1 minute timeout for image uploads
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()?;

    let extension = if config.monitoring.screenshots.format == "png" {
        "png"
    } else {
        "jpg"
    };

    let file_name = format!("screenshot_{}.{}", file_id, extension);
    let mime_type = if config.monitoring.screenshots.format == "png" {
        "image/png"
    } else {
        "image/jpeg"
    };

    let url = format!("{}/api/v1/files/upload", config.backend.url);

    let (agent_id, _) = _sync_manager.get_identity().await;

    // Create multipart form
    let form = multipart::Form::new()
        .text("file_id", file_id.to_string())
        .text("file_name", file_name.clone())
        .text("agent_id", agent_id)
        .text("file_path", format!("screenshot://{}", file_id))
        .text("file_size", image_data.len().to_string())
        .part(
            "file",
            multipart::Part::bytes(image_data.to_vec())
                .file_name(file_name)
                .mime_str(mime_type)?,
        );

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

    Ok(file_id.to_string())
}

#[cfg(target_os = "macos")]
async fn start_macos_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    info!("macOS screenshot monitoring not yet implemented");
    Ok(())
}

#[cfg(target_os = "linux")]
async fn start_linux_monitoring(
    _config: Arc<Config>,
    _sync_manager: Arc<SyncManager>,
) -> Result<()> {
    info!("Linux screenshot monitoring not yet implemented");
    Ok(())
}

/// Capture a single screenshot directly to a file (for helper mode)
pub async fn capture_to_file(output_path: &str) -> Result<()> {
    #[cfg(windows)]
    {
        use screenshots::Screen;
        
        let screens = Screen::all()?;
        if screens.is_empty() {
            anyhow::bail!("No screens found");
        }
        
        let screen = &screens[0];
        let image = screen.capture()?;
        
        info!("Helper captured {}x{} screenshot", image.width(), image.height());
        
        // Save directly to the output path
        image.save(output_path)?;
        
        info!("Screenshot saved to {}", output_path);
        Ok(())
    }
    
    #[cfg(not(windows))]
    {
        info!("capture_to_file not supported on this OS");
        let _ = output_path;
        Ok(())
    }
}

pub async fn run_helper(interval_secs: u64) -> Result<()> {
    #[cfg(windows)]
    {
        run_windows_helper(interval_secs).await
    }
    #[cfg(not(windows))]
    {
        info!("Screenshot helper not supported on this OS");
        tokio::time::sleep(Duration::from_secs(interval_secs)).await;
        Ok(())
    }
}

#[cfg(windows)]
async fn run_windows_helper(interval_secs: u64) -> Result<()> {
    use screenshots::Screen;
    use std::time::Instant;
    use std::fs;
    use std::path::Path;
    use sha2::{Sha256, Digest};

    let duration = Duration::from_secs(interval_secs);
    let mut interval_timer = interval(duration);
    
    // Shared folder where helper saves screenshots for the service to read
    let helper_folder = Path::new("C:\\ProgramData\\RAV\\helper_screenshots");
    
    // Ensure folder exists
    if let Err(e) = fs::create_dir_all(helper_folder) {
        error!("Failed to create helper screenshot folder: {}", e);
        return Err(e.into());
    }

    info!("Screenshot Helper started (Interval: {}s)", interval_secs);
    info!("Saving screenshots to: {}", helper_folder.display());

    let mut last_helper_hash = String::new();

    loop {
        interval_timer.tick().await;
        let start = Instant::now();

        match Screen::all() {
            Ok(screens) => {
                if !screens.is_empty() {
                    let screen = &screens[0];
                    match screen.capture() {
                        Ok(image) => {
                            // Convert to raw bytes for hashing
                            let raw_rgba = image.as_raw();
                            let mut hasher = Sha256::new();
                            hasher.update(raw_rgba);
                            let current_hash = format!("{:x}", hasher.finalize());
                            
                            // Skip if identical to the previous frame
                            if current_hash == last_helper_hash {
                                tracing::debug!("Helper: Frame identical, skipping write");
                                continue;
                            }
                            last_helper_hash = current_hash;

                            let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S%3f");
                            let filename = format!("screenshot_{}.png", timestamp);
                            let filepath = helper_folder.join(&filename);
                            
                            // Save screenshot
                            if let Err(e) = image.save(&filepath) {
                                error!("Helper: Failed to save screenshot: {}", e);
                                continue;
                            }
                            
                            info!("Helper: Captured {}x{} -> {} in {:?}", 
                                  image.width(), image.height(), filename, start.elapsed());
                            
                            // Cleanup old screenshots (keep only last 3)
                            cleanup_old_screenshots(helper_folder, 3).await;
                        }
                        Err(e) => error!("Helper: Capture failed: {}", e),
                    }
                }
            }
            Err(e) => error!("Helper: Failed to list screens: {}", e),
        }
    }
}

#[cfg(windows)]
async fn cleanup_old_screenshots(folder: &std::path::Path, keep_count: usize) {
    use std::fs;
    
    if let Ok(entries) = fs::read_dir(folder) {
        let mut files: Vec<_> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.path().extension().map_or(false, |ext| ext == "png"))
            .collect();
        
        // Sort by modification time (newest first)
        files.sort_by(|a, b| {
            let a_time = a.metadata().and_then(|m| m.modified()).ok();
            let b_time = b.metadata().and_then(|m| m.modified()).ok();
            b_time.cmp(&a_time)
        });
        
        // Delete older files
        for file in files.into_iter().skip(keep_count) {
            let path = file.path();
            if let Err(e) = fs::remove_file(&path) {
                tracing::warn!("Failed to cleanup old screenshot {:?}: {}", path, e);
            }
        }
    }
}

