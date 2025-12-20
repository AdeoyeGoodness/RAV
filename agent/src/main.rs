use anyhow::Result;
use std::sync::Arc;
use tokio::signal;
use tracing::{info, error, warn};

pub mod config;
pub mod encryption;
pub mod sync;
pub mod monitoring;
pub mod service;
pub mod agent_logic;

use config::Config;
use sync::SyncManager;
use agent_logic::{generate_agent_id, generate_hardware_fingerprint};

fn main() -> Result<()> {
    // Initialize logging (Basic for now)
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rav_agent=info".into()),
        )
        .init();

    // 1. CLI Argument Parsing
    let args: Vec<String> = std::env::args().collect();
    let mut cli_token = None;
    let mut cli_server = None;
    let mut install_flag = false;
    let mut uninstall_flag = false;

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
        
        // Implicitly install if enrolling? User said: "Runs once... Installs service... Exits"
        // Let's make it implicit if enrolling.
        if args[i] == "--install" {
            install_flag = true;
        }
        if args[i] == "--uninstall" {
            uninstall_flag = true;
        }
    }

    // 2. Handle Explicit CLI Commands (Install/Enroll/Uninstall)
    if cli_token.is_some() || cli_server.is_some() || install_flag || uninstall_flag {
        info!("RAV Agent: Processing CLI commands...");

        // Uninstall?
        if uninstall_flag {
            #[cfg(windows)]
            service::windows::uninstall_service()?;
            return Ok(());
        }

        let mut config = Config::load()?;
        let mut dirty = false;

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
                let sync_manager = Arc::new(SyncManager::new(config_arc.clone()).await?);
                
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

        info!("Agent setup complete. Exiting.");
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


