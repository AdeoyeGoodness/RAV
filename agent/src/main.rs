use anyhow::Result;
use std::sync::Arc;
use tokio::signal;
use tracing::{info, error, warn};

mod config;
mod encryption;
mod sync;
mod monitoring;
mod service;

use config::Config;
use sync::SyncManager;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rav_agent=info".into()),
        )
        .init();

    info!("RAV Agent starting...");

    // Load configuration
    let mut config = Config::load()?;
    
    // Generate agent_id and hardware_fingerprint if not set
    let mut config_changed = false;
    if config.agent.agent_id.is_none() {
        let agent_id = generate_agent_id();
        config.agent.agent_id = Some(agent_id.clone());
        info!("Generated agent_id: {}", agent_id);
        config_changed = true;
    }
    
    if config.agent.hardware_fingerprint.is_none() {
        let hw_fingerprint = generate_hardware_fingerprint();
        config.agent.hardware_fingerprint = Some(hw_fingerprint.clone());
        info!("Generated hardware_fingerprint: {}", hw_fingerprint);
        config_changed = true;
    }
    
    // Save config if we generated new IDs
    if config_changed {
        if let Err(e) = config.save() {
            warn!("Failed to save config: {}", e);
        } else {
            info!("Configuration saved");
        }
    }
    
    let config = Arc::new(config);
    info!("Configuration loaded");

    // Initialize encryption
    encryption::initialize(&config)?;
    info!("Encryption initialized");

    // Initialize sync manager
    let sync_manager = Arc::new(SyncManager::new(config.clone()).await?);
    info!("Sync manager initialized");

    // Start monitoring modules
    let monitoring_handle = start_monitoring(config.clone(), sync_manager.clone()).await?;
    info!("Monitoring modules started");

    // Start sync task
    let sync_handle = {
        let sync_manager = sync_manager.clone();
        tokio::spawn(async move {
            sync_manager.run_sync_loop().await;
        })
    };

    info!("RAV Agent running in background. Press Ctrl+C to stop.");
    info!("Note: Agent runs silently. Use the Dashboard at http://localhost:3000 to view data.");

    // Wait for shutdown signal
    signal::ctrl_c().await?;
    info!("Shutdown signal received, stopping agent...");

    // Graceful shutdown
    monitoring_handle.abort();
    sync_handle.abort();

    info!("RAV Agent stopped");
    Ok(())
}

fn generate_agent_id() -> String {
    // Use hostname as base for agent ID
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    
    // Generate a unique ID based on hostname and UUID
    use uuid::Uuid;
    let uuid_short = Uuid::new_v4().to_string().split('-').next().unwrap().to_string();
    format!("{}-{}", hostname, uuid_short)
}

fn generate_hardware_fingerprint() -> String {
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
        if let Ok(output) = Command::new("wmic")
            .args(&["csproduct", "get", "uuid"])
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
        // Start all monitoring modules as separate concurrent tasks
        // Each runs in its own infinite loop, so they need to be spawned separately
        
        // Start USB monitoring (runs in infinite loop)
        let config_usb = config.clone();
        let sync_usb = sync_manager.clone();
        tokio::spawn(async move {
            if let Err(e) = monitoring::usb::start_monitoring(config_usb, sync_usb).await {
                error!("USB monitoring error: {}", e);
            }
        });

        // Start network monitoring (runs in infinite loop)
        let config_network = config.clone();
        let sync_network = sync_manager.clone();
        tokio::spawn(async move {
            if let Err(e) = monitoring::network::start_monitoring(config_network, sync_network).await {
                error!("Network monitoring error: {}", e);
            }
        });

        // Start screenshot monitoring (runs in infinite loop)
        let config_screenshots = config.clone();
        let sync_screenshots = sync_manager.clone();
        info!("Attempting to start screenshot monitoring...");
        tokio::spawn(async move {
            if let Err(e) = monitoring::screenshots::start_monitoring(config_screenshots, sync_screenshots).await {
                error!("Screenshot monitoring error: {}", e);
            }
        });

        // Start extension server (HTTP endpoint for browser extension)
        let config_extension = config.clone();
        let sync_extension = sync_manager.clone();
        info!("Starting extension server on http://127.0.0.1:8089");
        tokio::spawn(async move {
            if let Err(e) = monitoring::extension_server::start_extension_server(config_extension, sync_extension).await {
                error!("Extension server error: {}", e);
            }
        });

        // Keep this task alive forever (all monitoring tasks run in background)
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await;
        }
    });

    Ok(handle)
}

