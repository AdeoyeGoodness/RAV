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

    loop {
        interval_timer.tick().await;

        // Capture screenshot
        match capture_windows_screenshot(&config).await {
            Ok((image_data, width, height)) => {
                info!("Screenshot captured: {}x{} ({} bytes)", width, height, image_data.len());

                // Generate file ID from hash
                let mut hasher = Sha256::new();
                hasher.update(&image_data);
                hasher.update(Utc::now().to_rfc3339().as_bytes());
                let file_hash = format!("{:x}", hasher.finalize());
                let file_id = format!(
                    "screenshot_{}_{}",
                    Utc::now().format("%Y%m%d_%H%M%S"),
                    &file_hash[..16]
                );

                // Upload screenshot to backend
                match upload_screenshot(
                    &file_id,
                    &image_data,
                    width,
                    height,
                    &config,
                    &sync_manager,
                )
                .await
                {
                    Ok(backup_file_id) => {
                        let (agent_id, _) = sync_manager.get_identity().await;
                        // Log screenshot event
                        let event = Event {
                            event_type: "screenshot_captured".to_string(),
                            timestamp: Utc::now(),
                            agent_id,
                            metadata: json!({
                                "file_id": backup_file_id,
                                "width": width,
                                "height": height,
                                "file_size": image_data.len(),
                                "format": config.monitoring.screenshots.format,
                                "platform": "windows",
                            }),
                        };
                        sync_manager.queue_event(event);
                        // Trigger immediate sync for screenshots to reduce delay
                        let sync_manager_clone = sync_manager.clone();
                        tokio::spawn(async move {
                            sync_manager_clone.sync_events_immediate().await;
                        });
                        info!("Screenshot uploaded and event logged: {}", backup_file_id);
                    }
                    Err(e) => {
                        error!("Failed to upload screenshot: {}", e);
                        let (agent_id, _) = sync_manager.get_identity().await;
                        // Still log the event even if upload fails
                        let event = Event {
                            event_type: "screenshot_captured".to_string(),
                            timestamp: Utc::now(),
                            agent_id,
                            metadata: json!({
                                "file_id": file_id,
                                "width": width,
                                "height": height,
                                "file_size": image_data.len(),
                                "format": config.monitoring.screenshots.format,
                                "platform": "windows",
                                "upload_error": format!("{}", e),
                            }),
                        };
                        sync_manager.queue_event(event);
                        // Trigger immediate sync even for failed uploads
                        let sync_manager_clone = sync_manager.clone();
                        tokio::spawn(async move {
                            sync_manager_clone.sync_events_immediate().await;
                        });
                    }
                }
            }
            Err(e) => {
                error!("Failed to capture screenshot: {}", e);
            }
        }
    }
}

#[cfg(windows)]
async fn capture_windows_screenshot(config: &Config) -> Result<(Vec<u8>, u32, u32)> {
    use screenshots::Screen;
    use image::{DynamicImage, ImageOutputFormat, RgbImage, ImageBuffer};
    use std::io::Cursor;

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
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    info!("Linux screenshot monitoring not yet implemented");
    Ok(())
}

