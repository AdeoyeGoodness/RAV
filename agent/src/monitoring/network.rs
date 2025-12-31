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
    if !config.monitoring.network.enabled {
        info!("Network monitoring is disabled");
        return Ok(());
    }

    info!("Starting network monitoring");

    let mut interval = interval(Duration::from_secs(10));

    loop {
        interval.tick().await;

        if config.monitoring.network.track_connections {
            if let Err(e) = monitor_connections(config.clone(), sync_manager.clone()).await {
                error!("Connection monitoring error: {}", e);
            }
        }

        if config.monitoring.network.track_dns {
            // DNS monitoring would be implemented here
            // This requires platform-specific implementations
        }
    }
}

async fn monitor_connections(
    config: Arc<Config>,
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    let mut previous_connections: std::collections::HashSet<String> = std::collections::HashSet::new();

    loop {
        // Monitor every 10 seconds
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

        if let Ok(connections) = get_active_connections().await {
            let mut current_hashes = std::collections::HashSet::new();

            for conn in connections {
                // Create a unique signature for the connection
                let conn_hash = format!("{}:{}-{}:{}", conn.local_ip, conn.local_port, conn.remote_ip, conn.remote_port);
                
                if !previous_connections.contains(&conn_hash) {
                    let (agent_id, _) = sync_manager.get_identity().await;
                    let event = Event {
                        event_type: "network_connection".to_string(),
                        timestamp: Utc::now(),
                        agent_id,
                        metadata: json!({
                            "local_ip": conn.local_ip,
                            "local_port": conn.local_port,
                            "remote_ip": conn.remote_ip,
                            "remote_port": conn.remote_port,
                            "protocol": conn.protocol,
                            "process_name": conn.process_name,
                            "process_id": conn.process_id,
                            "status": "ESTABLISHED",
                        }),
                    };
                    sync_manager.queue_event(event);
                }
                current_hashes.insert(conn_hash);
            }
            
            // Update state
            previous_connections = current_hashes;
        }
    }
}

#[derive(Debug)]
struct Connection {
    local_ip: String,
    local_port: u16,
    remote_ip: String,
    remote_port: u16,
    protocol: String,
    process_name: String,
    process_id: u32,
}

async fn get_active_connections() -> Result<Vec<Connection>> {
    #[cfg(windows)]
    {
        get_windows_connections().await
    }

    #[cfg(target_os = "macos")]
    {
        get_macos_connections().await
    }

    #[cfg(target_os = "linux")]
    {
        get_linux_connections().await
    }
}

#[cfg(windows)]
async fn get_windows_connections() -> Result<Vec<Connection>> {
    use std::process::Command;
    
    let output = Command::new("netstat")
        .args(&["-ano"])
        .output()?;

    let output_str = String::from_utf8_lossy(&output.stdout);
    let mut connections = Vec::new();

    for line in output_str.lines().skip(4) {
        // Parse netstat output
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            if let (Some(proto), Some(local), Some(remote), Some(state), Some(pid)) = 
                (parts.get(0), parts.get(1), parts.get(2), parts.get(3), parts.get(4)) {
                
                if *state == "ESTABLISHED" || *state == "LISTENING" {
                    if let Some((local_ip, local_port)) = parse_address(local) {
                        if let Some((remote_ip, remote_port)) = parse_address(remote) {
                            let process_name = get_process_name(*pid).unwrap_or_else(|_| "unknown".to_string());
                            
                            connections.push(Connection {
                                local_ip,
                                local_port,
                                remote_ip,
                                remote_port,
                                protocol: proto.to_string(),
                                process_name,
                                process_id: pid.parse().unwrap_or(0),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(connections)
}

#[cfg(windows)]
fn parse_address(addr: &str) -> Option<(String, u16)> {
    let parts: Vec<&str> = addr.rsplitn(2, ':').collect();
    if parts.len() == 2 {
        if let (Some(ip), Some(port_str)) = (parts.get(1), parts.get(0)) {
            if let Ok(port) = port_str.parse::<u16>() {
                return Some((ip.to_string(), port));
            }
        }
    }
    None
}

#[cfg(windows)]
fn get_process_name(pid: &str) -> Result<String> {
    use std::process::Command;
    
    let output = Command::new("tasklist")
        .args(&["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .output()?;
    
    let output_str = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = output_str.split(',').collect();
    if let Some(name) = parts.get(0) {
        Ok(name.trim_matches('"').to_string())
    } else {
        Ok("unknown".to_string())
    }
}

#[cfg(target_os = "macos")]
async fn get_macos_connections() -> Result<Vec<Connection>> {
    // macOS implementation using netstat or lsof
    Ok(Vec::new())
}

#[cfg(target_os = "linux")]
async fn get_linux_connections() -> Result<Vec<Connection>> {
    use std::fs;
    use std::path::Path;
    
    let mut connections = Vec::new();
    
    // Read /proc/net/tcp
    let tcp_path = Path::new("/proc/net/tcp");
    if tcp_path.exists() {
        let content = fs::read_to_string(tcp_path)?;
        for line in content.lines().skip(1) {
            // Parse /proc/net/tcp format
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 10 {
                // Parse local and remote addresses
                // Format: sl local_address rem_address st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode
                if let (Some(local), Some(remote)) = (parts.get(1), parts.get(2)) {
                    if let Some((local_ip, local_port)) = parse_proc_address(local) {
                        if let Some((remote_ip, remote_port)) = parse_proc_address(remote) {
                            connections.push(Connection {
                                local_ip,
                                local_port,
                                remote_ip,
                                remote_port,
                                protocol: "tcp".to_string(),
                                process_name: "unknown".to_string(),
                                process_id: 0,
                            });
                        }
                    }
                }
            }
        }
    }
    
    Ok(connections)
}

#[cfg(target_os = "linux")]
fn parse_proc_address(addr: &str) -> Option<(String, u16)> {
    // Format: 0100007F:0019 (hex IP:hex port)
    let parts: Vec<&str> = addr.split(':').collect();
    if parts.len() == 2 {
        if let (Some(ip_hex), Some(port_hex)) = (parts.get(0), parts.get(1)) {
            if let Ok(port) = u16::from_str_radix(port_hex, 16) {
                // Parse hex IP (little-endian)
                if ip_hex.len() == 8 {
                    if let Ok(ip_bytes) = (0..4)
                        .map(|i| u8::from_str_radix(&ip_hex[i*2..i*2+2], 16))
                        .collect::<Result<Vec<_>, _>>() {
                        let ip = format!("{}.{}.{}.{}", ip_bytes[3], ip_bytes[2], ip_bytes[1], ip_bytes[0]);
                        return Some((ip, port));
                    }
                }
            }
        }
    }
    None
}

