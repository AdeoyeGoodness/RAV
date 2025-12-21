use anyhow::Result;
use std::sync::Arc;
use tracing::{info, error};
use std::future::Future;

use crate::config::Config;
use crate::encryption;
use crate::sync::SyncManager;
use crate::monitoring;
use crate::storage;

pub async fn run_agent(config: Config, shutdown_signal: impl Future<Output = ()>) -> Result<()> {
    // 4. Initialize Dependency (SyncManager)
    let config_arc = Arc::new(config);
    encryption::initialize(&config_arc)?;
    
    // Init Persistence
    let storage = Arc::new(storage::StorageManager::new(config_arc.agent.data_dir.clone())?);
    
    let sync_manager = Arc::new(SyncManager::new(config_arc.clone(), storage)?);

    info!("Sync manager initialized");

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

    // Wait for shutdown signal
    shutdown_signal.await;
    info!("Shutdown signal received, stopping agent...");

    // Graceful shutdown
    monitoring_handle.abort();
    sync_handle.abort();

    info!("RAV Agent stopped");
    Ok(())
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
