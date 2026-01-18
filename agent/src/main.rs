use anyhow::Result;
use std::sync::Arc;
// use tokio::signal;
use tracing::info;

pub mod config;
pub mod encryption;
pub mod sync;
pub mod monitoring;
pub mod service;
pub mod agent_logic;
pub mod storage;

use config::Config;
use sync::SyncManager;
use agent_logic::{generate_agent_id, generate_hardware_fingerprint};

fn main() -> Result<()> {
    // 1. CLI Argument Parsing (Fast, no side effects)
    let args: Vec<String> = std::env::args().collect();
    let mut install_flag = false;
    let mut uninstall_flag = false;
    let mut helper_flag = false;
    let mut native_host_flag = false;
    let mut cli_token = None;
    let mut cli_server = None;

    for i in 0..args.len() {
        if args[i] == "--enroll" || args[i] == "--enrollment-token" {
            if i + 1 < args.len() {
                cli_token = Some(args[i + 1].clone());
            }
        }
        if args[i] == "--server" {
            if i + 1 < args.len() {
                cli_server = Some(args[i + 1].clone());
            }
        }
        if args[i] == "--install" {
            install_flag = true;
        }
        if args[i] == "--uninstall" {
            uninstall_flag = true;
        }
        if args[i] == "--screenshot-helper" {
            helper_flag = true;
        }
        if args[i] == "--native-host" {
            native_host_flag = true;
        }
    }

    // 2. Initialize Logging
    if helper_flag {
        // Screenshot Helper: No file logging (Security requirement: No disk writes)
        tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "rav_agent=info".into()))
            .init();
        info!("RAV Screenshot Helper starting...");
    } else {
        // Service/CLI: Standard + File Logging
        let log_dir = "C:\\ProgramData\\RAV\\logs";
        let _ = std::fs::create_dir_all(log_dir);
        let file_appender = tracing_appender::rolling::daily(log_dir, "agent.log");
        let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

        tracing_subscriber::fmt()
            .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "rav_agent=info".into()))
            .with_writer(non_blocking)
            .init();
        
        // This guard must live for the duration of the program.
        std::mem::forget(_guard); 
        
        info!("RAV Agent starting (v{})", env!("CARGO_PKG_VERSION"));
    }

    // 3. Handle Explicit CLI Commands (Install/Enroll/Uninstall/Helper/NativeHost)
    if cli_token.is_some() || cli_server.is_some() || install_flag || uninstall_flag || helper_flag || native_host_flag {
        info!("RAV Agent: Processing CLI commands...");

        // Native Messaging Host?
        if native_host_flag {
            info!("RAV Agent: Running in Native Messaging Host mode...");
            let config = Arc::new(Config::load()?);
            encryption::initialize(&config)?;
            let storage = Arc::new(storage::StorageManager::new(config.agent.data_dir.clone())?);
            let sync_manager = Arc::new(SyncManager::new(config.clone(), storage)?);
            
            monitoring::native_host::run_native_host(config, sync_manager)?;
            return Ok(());
        }

        // Screenshot Helper?
        if helper_flag {
            // Self-hide console window on Windows to avoid annoying popup
            #[cfg(windows)]
            hide_console_window();

            let mut interval_secs = 60; // Default
            let mut output_path: Option<String> = None;
            
            for i in 0..args.len() {
                if args[i] == "--interval" && i + 1 < args.len() {
                    if let Ok(val) = args[i + 1].parse::<u64>() {
                        interval_secs = val;
                    }
                }
                if args[i] == "--output" && i + 1 < args.len() {
                    output_path = Some(args[i + 1].clone());
                }
            }
            
            // One-shot mode if --output is specified
            if let Some(path) = output_path {
                info!("RAV Agent: Screenshot Helper one-shot mode to {}", path);
                let rt = tokio::runtime::Runtime::new()?;
                rt.block_on(async {
                    monitoring::screenshots::capture_to_file(&path).await
                })?;
                return Ok(());
            }
            
            info!("RAV Agent: Running in Screenshot Helper mode (Interval: {}s)...", interval_secs);
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(async {
                monitoring::screenshots::run_helper(interval_secs).await
            })?;
            return Ok(());
        }

        // Uninstall?
        if uninstall_flag {
            #[cfg(windows)]
            service::windows::uninstall_service()?;
            return Ok(());
        }

        let mut config = Config::load()?;
        let mut dirty = false;

        // Ensure HW Fingerprint is valid
        let current_fp = config.agent.hardware_fingerprint.clone().unwrap_or_default();
        if config.agent.hardware_fingerprint.is_none() || current_fp == "unknown" || current_fp.starts_with("unknown") || current_fp.is_empty() {
             let fp = generate_hardware_fingerprint();
             info!("Generated Hardware Fingerprint: {}", fp);
             config.agent.hardware_fingerprint = Some(fp);
             dirty = true;
        }

        // Update URL
        if let Some(url) = cli_server {
            info!("Updated Backend URL: {}", url);
            config.backend.url = url;
            dirty = true;
        }

        // Handle Enrollment
        if let Some(token) = cli_token {
            info!("Enrollment token provided. Configuring...");
            config.backend.enrollment_token = Some(token);
            config.agent.agent_id = None;
            config.agent.organization_id = None;
            
            // We need async for enrollment
            let rt = tokio::runtime::Runtime::new()?;
            rt.block_on(async {
                // Initialize strict dependency chain just for enrollment
                // Use temp config in Arc
                let config_arc = Arc::new(config.clone());
                encryption::initialize(&config_arc)?;
                
                // Init Persistence
                let storage = Arc::new(storage::StorageManager::new(config.agent.data_dir.clone())?);
                
                let sync_manager = Arc::new(SyncManager::new(config_arc.clone(), storage)?);
                
                info!("Connecting to backend for enrollment...");
                match sync_manager.enroll_agent().await {
                    Ok((agent_id, org_id)) => {
                        config.agent.organization_id = Some(org_id);
                        config.agent.agent_id = Some(agent_id);
                        config.backend.enrollment_token = None; // Security wipe
                        config.save()?;
                        info!("Enrollment Successful! Config persisted.");
                        Ok(())
                    },
                    Err(e) => Err(e),
                }
            })?;
        } else if dirty {
            config.save()?;
        }

        // Install Service (Implicit or Explicit)
        // If we enrolled successfully (or just flags passed), we proceed to install.
        // User scenario: `rav-agent.exe --server... --enroll...` -> Install service.
        #[cfg(windows)]
        {
            info!("Installing Windows Service...");
            if let Err(e) = service::windows::install_service() {
               // Ignore if already exists?
               tracing::warn!("Service installation note: {}", e);
            }
            
            info!("Starting Windows Service...");
            if let Err(e) = service::windows::start_service() {
                tracing::warn!("Service start note: {}", e);
            }
        }

        info!("Agent setup complete. Transitioning to monitoring mode...");
        
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(async {
             agent_logic::run_agent(config, async {
                 let _ = tokio::signal::ctrl_c().await;
             }).await
        })?;
        
        return Ok(());
    }

    // 3. No Flags: Try run as Service
    #[cfg(windows)]
    match service::windows::run_as_service() {
        Ok(_) => {
            // Service loop finished (stopped by SCM)
            return Ok(());
        },
        Err(_) => {
            // Failed to run as service -> We are running in Console Mode
            // Check if service is already running (to avoid duplicate)
            if let Ok(true) = service::windows::is_service_running() {
                println!("RAV Agent is already running as a background service.");
                return Ok(());
            }
            
            // Debug / Foreground Mode
            println!("Starting RAV Agent in Console Mode (Press Ctrl+C to stop)...");
            let config = Config::load()?;
            let rt = tokio::runtime::Runtime::new()?;
            
            // Run until Ctrl+C
            rt.block_on(async {
                 agent_logic::run_agent(config, async {
                     let _ = tokio::signal::ctrl_c().await;
                 }).await
            })?;
        }
    }

    #[cfg(not(windows))]
    {
        // Non-Windows fallback (Linux/Mac) - Just run standard
        // (Assuming similar service logic would be implemented in service::linux/macos eventually)
        println!("Starting RAV Agent (Non-Windows)...");
        let config = Config::load()?;
        let rt = tokio::runtime::Runtime::new()?;
        rt.block_on(async {
             agent_logic::run_agent(config, async {
                 let _ = tokio::signal::ctrl_c().await;
             }).await
        })?;
    }

    Ok(())
}

#[cfg(windows)]
fn hide_console_window() {
    use winapi::um::wincon::GetConsoleWindow;
    use winapi::um::winuser::{ShowWindow, SW_HIDE};
    
    unsafe {
        let window = GetConsoleWindow();
        if !window.is_null() {
            ShowWindow(window, SW_HIDE);
        }
    }
}


