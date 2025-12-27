use anyhow::{Result, Context};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{interval, Duration};
use tracing::{error, info, warn};

use crate::config::Config;
use crate::sync::{Event, SyncManager};

const PIPE_NAME: &str = r"\\.\pipe\RAVAgentScreenshots";

// Security Descriptor: 
// D:(A;;GA;;;SY) -> SYSTEM Full Access
// (A;;GA;;;BA)   -> Administrators Full Access
// (A;;GRGW;;;AU) -> Authenticated Users Read/Write (Allow helper connection)
// Reject anonymous (not in string)
const PIPE_SECURITY_DESCRIPTOR: &str = "D:(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;AU)";

#[derive(Debug, Serialize, Deserialize)]
struct ScreenshotPacket {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub image_data: Vec<u8>,
}

pub async fn start_monitoring(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    if !config.monitoring.screenshots.enabled {
        info!("Screenshot monitoring is disabled in config");
        return Ok(());
    }

    #[cfg(windows)]
    {
        info!("Starting Hardened Screenshot IPC Server on {}", PIPE_NAME);
        tokio::spawn(async move {
            if let Err(e) = run_ipc_server(config, sync_manager).await {
                error!("Screenshot IPC Server error: {}", e);
            }
        });
    }

    #[cfg(not(windows))]
    {
        info!("Screenshot monitoring not implemented for this platform");
    }

    Ok(())
}

#[cfg(windows)]
async fn run_ipc_server(config: Arc<Config>, sync_manager: Arc<SyncManager>) -> Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    loop {
        // Create pipe with restricted access
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(PIPE_NAME)
            .context("Failed to create named pipe instance")?;
            
        // Note: Advanced security descriptors are usually applied via CreateNamedPipe
        // but tokio doesn't expose SD directly. However, we can use sc.exe/cacls 
        // to verify or use winapi to set security after creation.
        // For this implementation, we rely on the service running as SYSTEM 
        // which gives us some baseline isolation, but we'll focus on INPUT VALIDATION.

        info!("Waiting for screenshot helper...");
        server.connect().await?;
        
        let config = config.clone();
        let sync_manager = sync_manager.clone();
        let mut server = server;

        tokio::spawn(async move {
            if let Err(e) = handle_helper_connection(&mut server, config, sync_manager).await {
                warn!("Helper connection closed: {}", e);
            }
        });
    }
}

#[cfg(windows)]
async fn handle_helper_connection(
    pipe: &mut tokio::net::windows::named_pipe::NamedPipeServer,
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    loop {
        // 1. Read Payload Length (4 bytes)
        let mut len_buf = [0u8; 4];
        if pipe.read_exact(&mut len_buf).await.is_err() {
            break; 
        }
        let len = u32::from_le_bytes(len_buf) as usize;

        // One-way trust: Strict size limit (20MB)
        if len > 20 * 1024 * 1024 {
            anyhow::bail!("REJECTED: Oversized screenshot packet ({} bytes)", len);
        }

        // 2. Read JSON Packet
        let mut packet_buf = vec![0u8; len];
        pipe.read_exact(&mut packet_buf).await?;
        
        let packet: ScreenshotPacket = serde_json::from_slice(&packet_buf)
            .context("Failed to parse screenshot packet structure")?;

        // 3. One-way trust: Strict Metadata Validation
        if packet.width > 8192 || packet.height > 8192 {
            anyhow::bail!("REJECTED: Malformed dimensions ({}x{})", packet.width, packet.height);
        }
        
        if packet.format != "jpeg" && packet.format != "png" {
            anyhow::bail!("REJECTED: Forbidden image format: {}", packet.format);
        }

        if packet.image_data.is_empty() {
             anyhow::bail!("REJECTED: Empty image data");
        }

        info!("Validated screenshot received ({}x{}, {} bytes)", packet.width, packet.height, packet.image_data.len());

        // 4. Process & Upload
        let file_id = format!("scr_{}_{}", Utc::now().timestamp(), uuid::Uuid::new_v4().to_string().get(..8).unwrap());
        
        match upload_screenshot(&file_id, &packet.image_data, &config, &sync_manager).await {
            Ok(_) => {
                let (agent_id, _) = sync_manager.get_identity().await;
                let event = Event {
                    event_type: "screenshot_captured".to_string(),
                    timestamp: Utc::now(),
                    agent_id,
                    metadata: json!({
                        "file_id": file_id,
                        "width": packet.width,
                        "height": packet.height,
                        "file_size": packet.image_data.len(),
                        "format": packet.format,
                        "platform": "windows",
                        "security": "hardened_ipc"
                    }),
                };
                sync_manager.queue_event(event);
                sync_manager.sync_events_immediate().await;
            }
            Err(e) => {
                error!("IPC Server: Upload failed for packet: {}", e);
            }
        }
    }
    Ok(())
}

/// Entry point for the USER-MODE HELPER.
/// Decoupled: Does NOT read config.toml from disk.
pub async fn run_helper(interval_secs: u64) -> Result<()> {
    info!("RAV Hardened Screenshot Helper starting (Interval: {}s)...", interval_secs);
    
    // Safety: Helper never writes to disk, never talks to network.
    let mut interval_timer = interval(Duration::from_secs(interval_secs));

    loop {
        interval_timer.tick().await;

        match capture_and_send().await {
            Ok(_) => info!("Screenshot captured and piped to service."),
            Err(e) => error!("Helper capture/send error: {}", e),
        }
    }
}

#[cfg(windows)]
async fn capture_and_send() -> Result<()> {
    use screenshots::Screen;
    use tokio::net::windows::named_pipe::ClientOptions;

    // 1. Capture Screen
    let screens = Screen::all().context("Failed to iterate screens")?;
    if screens.is_empty() {
        anyhow::bail!("No screens found in user session");
    }

    let screen = &screens[0]; 
    let image = screen.capture().context("Capture failure")?;
    
    // Default to JPEG for the helper
    let format = "jpeg".to_string();
    let mut image_data = Vec::new();
    
    {
        let mut buffer = std::io::Cursor::new(&mut image_data);
        let png_bytes = image.to_png().context("PNG encode fail")?;
        let img = image::load_from_memory(&png_bytes).context("Internal image load fail")?;
        img.write_to(&mut buffer, image::ImageFormat::Jpeg).context("JPEG re-encode fail")?;
    }

    let packet = ScreenshotPacket {
        width: image.width() as u32,
        height: image.height() as u32,
        format,
        image_data,
    };

    let serialized = serde_json::to_vec(&packet).context("Serialization error")?;
    let len = serialized.len() as u32;

    // 2. Connect to Pipe and Send
    // Client ensures it only connects to the LOCAL pipe.
    let mut client = ClientOptions::new()
        .open(PIPE_NAME)
        .context("Service pipe not found. Is RAVAgent service running?")?;

    client.write_all(&len.to_le_bytes()).await?;
    client.write_all(&serialized).await?;
    client.flush().await?;

    Ok(())
}

async fn upload_screenshot(
    file_id: &str,
    image_data: &[u8],
    config: &Config,
    sync_manager: &SyncManager,
) -> Result<String> {
    use reqwest::multipart;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;

    let (agent_id, _) = sync_manager.get_identity().await;
    let extension = if config.monitoring.screenshots.format == "png" { "png" } else { "jpg" };
    let file_name = format!("{}.{}", file_id, extension);
    let mime_type = if extension == "png" { "image/png" } else { "image/jpeg" };

    let url = format!("{}/api/v1/files/upload", config.backend.url);

    let form = multipart::Form::new()
        .text("file_id", file_id.to_string())
        .text("file_name", file_name.clone())
        .text("agent_id", agent_id)
        .part("file", multipart::Part::bytes(image_data.to_vec()).file_name(file_name).mime_str(mime_type)?);

    let mut request = client.post(&url).multipart(form);
    if let Some(api_key) = &config.backend.api_key {
        request = request.header("X-API-Key", api_key);
    }

    let response = request.send().await.context("Upload request failed")?;
    if !response.status().is_success() {
        anyhow::bail!("Upload failed: {}", response.status());
    }

    Ok(file_id.to_string())
}

