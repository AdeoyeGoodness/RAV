use std::ffi::OsString;
use std::sync::mpsc;
use std::time::Duration;
use windows_service::{
    define_windows_service,
    service::{
        ServiceAccess, ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
        ServiceType,
    },
    service_control_handler::{self, ServiceControlHandlerResult},
    service_dispatcher,
    service_manager::{ServiceManager, ServiceManagerAccess},
};
use anyhow::{Context, Result};
use tracing::{info, error};

use crate::config::Config;
use crate::agent_logic;

const SERVICE_NAME: &str = "RAV Agent";
const SERVICE_TYPE: ServiceType = ServiceType::OWN_PROCESS;

pub fn install_service() -> Result<()> {
    let current_exe = std::env::current_exe()?;
    let exe_path = current_exe.to_str().context("Invalid executable path")?;
    
    // Use sc.exe for robust installation
    // Note: sc expects space after =
    let status = std::process::Command::new("sc")
        .arg("create")
        .arg(SERVICE_NAME)
        .arg(&format!("binPath= {}", exe_path))
        .arg("DisplayName= RAV Agent Enterprise Monitor")
        .arg("start= auto")
        .arg("type= own")
        .output()
        .context("Failed to execute sc create")?;
        
    if !status.status.success() {
        let err = String::from_utf8_lossy(&status.stderr);
        // If service already exists, that's fine/warning
        if err.contains("1073") || err.contains("exists") {
             tracing::warn!("Service likely already exists (sc output: {})", err.trim());
        } else {
             anyhow::bail!("sc create failed: {}", err.trim());
        }
    }
    
    // Set description (optional, separate command)
    let _ = std::process::Command::new("sc")
        .arg("description")
        .arg(SERVICE_NAME)
        .arg("Remote Agent Verification Enterprise Monitor")
        .output();

    // Configure Failure Recovery: Restart Service after 1 minute (60000ms) for 1st, 2nd, and subsequent failures.
    // reset= 86400 (Reset failure count after 1 day)
    let _ = std::process::Command::new("sc")
        .arg("failure")
        .arg(SERVICE_NAME)
        .arg("reset=")
        .arg("86400")
        .arg("actions=")
        .arg("restart/60000/restart/60000/restart/60000")
        .output();
    
    info!("Service '{}' installed successfully via sc.", SERVICE_NAME);
    Ok(())
}

pub fn uninstall_service() -> Result<()> {
    // Attempt stop first
    let _ = std::process::Command::new("sc").arg("stop").arg(SERVICE_NAME).output();
    std::thread::sleep(Duration::from_secs(1)); // Grace period

    let status = std::process::Command::new("sc")
        .arg("delete")
        .arg(SERVICE_NAME)
        .output()
        .context("Failed to execute sc delete")?;
        
    if !status.status.success() {
        let err = String::from_utf8_lossy(&status.stderr);
        anyhow::bail!("sc delete failed: {}", err.trim());
    }
    
    info!("Service '{}' uninstalled successfully via sc.", SERVICE_NAME);
    Ok(())
}

pub fn is_service_running() -> Result<bool> {
    let manager = ServiceManager::local_computer(None::<&str>, ServiceManagerAccess::CONNECT)?;
    match manager.open_service(SERVICE_NAME, ServiceAccess::QUERY_STATUS) {
        Ok(service) => {
            let status = service.query_status()?;
            Ok(status.current_state == ServiceState::Running || status.current_state == ServiceState::StartPending)
        },
        Err(_) => Ok(false),
    }
}

pub fn start_service() -> Result<()> {
    let status = std::process::Command::new("sc")
        .arg("start")
        .arg(SERVICE_NAME)
        .output()
        .context("Failed to execute sc start")?;
        
    if !status.status.success() {
        let err = String::from_utf8_lossy(&status.stderr);
        if err.contains("1056") { // Already running
             info!("Service is already running.");
             return Ok(());
        }
        anyhow::bail!("sc start failed: {}", err.trim());
    }
    
    info!("Service '{}' start signal sent via sc.", SERVICE_NAME);
    Ok(())
}

// Entry point for Service Execution
pub fn run_as_service() -> Result<()> {
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)
        .context("Failed to start service dispatcher")?;
    Ok(())
}

define_windows_service!(ffi_service_main, my_service_main);

fn my_service_main(_arguments: Vec<OsString>) {
    // This runs on a separate thread spawned by SCM.
    
    // 1. Initialize Logging (File based? or EventLog? For now, standard env_filter but stdout goes nowhere)
    // NOTE: In production, services should log to file or EventLog.
    // We assume Config::load sets up logging if we call main init? 
    // Actually `main.rs` did `tracing_subscriber`. We need to do it here too if we want logs.
    // For now, let's skip complex logging setup to reuse `config`.

    if let Err(e) = run_service_logic() {
        // Can't easily log error if stdout is null, but we'll try
        eprintln!("Service error: {}", e);
    }
}

fn run_service_logic() -> Result<()> {
    // Create a channel to handle Stop Event
    let (shutdown_tx, shutdown_rx) = mpsc::channel();
    
    let event_handler = move |control_event| -> ServiceControlHandlerResult {
        match control_event {
            ServiceControl::Stop | ServiceControl::Interrogate => {
                let _ = shutdown_tx.send(());
                ServiceControlHandlerResult::NoError
            }
            _ => ServiceControlHandlerResult::NoError,
        }
    };

    // Register Handler
    let status_handle = service_control_handler::register(SERVICE_NAME, event_handler)?;

    // Report RUNNING
    status_handle.set_service_status(ServiceStatus {
        service_type: SERVICE_TYPE,
        current_state: ServiceState::Running,
        controls_accepted: ServiceControlAccept::STOP,
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    // Load Config (Must exist)
    // Note: If config is missing, this will fail and service will stop.
    // This is DESIRED behavior for "Strict Enterprise Mode".
    let config = match Config::load() {
        Ok(c) => c,
        Err(_) => {
            // Cannot run without config
            status_handle.set_service_status(ServiceStatus {
                service_type: SERVICE_TYPE,
                current_state: ServiceState::Stopped,
                controls_accepted: ServiceControlAccept::empty(),
                exit_code: ServiceExitCode::Win32(1), // Error
                checkpoint: 0,
                wait_hint: Duration::default(),
                process_id: None,
            })?;
            return Ok(());
        }
    };

    // Run Async Runtime for Agent Logic
    let rt = tokio::runtime::Runtime::new()?;
    // We create an async future that completes when `shutdown_rx` receives a message
    // Note: mpsc::Receiver is blocking. We can use `tokio::sync::oneshot` if acceptable, 
    // but `event_handler` is sync.
    // Easier: Just wrap the blocking recv in a task or poll?
    // Or just usage `rt.block_on` with a future that checks a flag?
    // Actually, we can use `tokio::sync::mpsc` inside `event_handler` if we store the Sender in global/mutex? No.
    // Best way with `mpsc`: `rt.block_on` runs the agent. Agent takes a `shutdown_signal` future.
    // `shutdown_signal` needs to be triggered by `shutdown_rx`.
    // Since `shutdown_rx.recv()` is blocking, we can spawn a thread to wait for it and notify an async Notify/Channel.
    
    let (async_stop_tx, async_stop_rx) = tokio::sync::oneshot::channel();
    
    std::thread::spawn(move || {
        let _ = shutdown_rx.recv(); // Block until stop
        let _ = async_stop_tx.send(()); // Notify async world
    });

    let shutdown_signal = async move {
        let _ = async_stop_rx.await;
    };

    rt.block_on(agent_logic::run_agent(config, shutdown_signal))?;

    // Report STOPPED
    status_handle.set_service_status(ServiceStatus {
        service_type: SERVICE_TYPE,
        current_state: ServiceState::Stopped,
        controls_accepted: ServiceControlAccept::empty(),
        exit_code: ServiceExitCode::Win32(0),
        checkpoint: 0,
        wait_hint: Duration::default(),
        process_id: None,
    })?;

    Ok(())
}
