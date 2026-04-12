use anyhow::Result;
use std::sync::Arc;
use tracing::{info, error, warn};
use std::future::Future;

use crate::config::Config;
use crate::encryption;
use crate::sync::SyncManager;
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

        // 4. Extension Server
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
