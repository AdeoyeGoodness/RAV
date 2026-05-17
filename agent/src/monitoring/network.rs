use anyhow::Result;
use chrono::Utc;
use serde_json::json;
use std::sync::Arc;
use tokio::time::Duration;
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

    let sync_c = sync_manager.clone();
    tokio::spawn(async move {
        if let Err(e) = monitor_connections(sync_c).await {
            error!("Connection monitoring error: {}", e);
        }
    });

    let sync_w = sync_manager.clone();
    tokio::spawn(async move {
        loop {
            if let Err(e) = monitor_wifi_status(sync_w.clone()).await {
                error!("WiFi monitoring error: {}", e);
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });

    // Block forever so the watchdog doesn't think this module "exited" and re-spawn it
    loop {
        tokio::time::sleep(Duration::from_secs(3600)).await;
    }
}

async fn monitor_wifi_status(sync_manager: Arc<SyncManager>) -> Result<()> {
    let storage = sync_manager.get_storage();
    
    // Forensic Resume: Load rich state from SQLite
    let last_state: Option<serde_json::Value> = match storage.load_state("network_wifi_rich_state") {
        Ok(v) => v,
        _ => None,
    };

    if let Ok(wifi) = get_wifi_info().await {
        let mut changed = false;
        let mut previous_ssid = None;
        let mut change_detected_after_restart = false;

        if let Some(state) = &last_state {
            let last_s = state.get("ssid").and_then(|s| s.as_str()).unwrap_or("");
            let last_b = state.get("bssid").and_then(|s| s.as_str()).unwrap_or("");
            
            if last_s != wifi.ssid || last_b != wifi.bssid {
                changed = true;
                previous_ssid = Some(last_s.to_string());
                // If this is the FIRST check since the agent started, it's a resume detection
                static mut FIRST_CHECK: bool = true;
                unsafe {
                    if FIRST_CHECK {
                        change_detected_after_restart = true;
                        FIRST_CHECK = false;
                    }
                }
            }
        } else {
            // First time seeing ANY wifi - log it as a connection
            changed = true;
        }

        if changed {
            info!("WIFI TRANSITION: {} -> {}", previous_ssid.as_deref().unwrap_or("NONE"), wifi.ssid);
            
            let (agent_id, _) = sync_manager.get_identity().await;
            let event = Event {
                event_type: "wifi_changed".to_string(),
                timestamp: Utc::now(),
                agent_id,
                metadata: json!({
                    "previous_ssid": previous_ssid,
                    "current_ssid": wifi.ssid,
                    "current_bssid": wifi.bssid,
                    "interface": wifi.interface,
                    "signal": wifi.signal,
                    "change_detected_after_restart": change_detected_after_restart
                }),
            };
            sync_manager.queue_event(event);
            
            // Persist rich state
            let _ = storage.save_state("network_wifi_rich_state", &json!({
                "ssid": wifi.ssid,
                "bssid": wifi.bssid,
                "interface": wifi.interface,
                "last_seen_at": Utc::now()
            }));
        }
    }
    Ok(())
}

struct WifiInfo {
    ssid: String,
    bssid: String,
    signal: String,
    interface: String,
}

async fn get_wifi_info() -> Result<WifiInfo> {
    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = Command::new("netsh")
            .args(&["wlan", "show", "interfaces"])
            .creation_flags(CREATE_NO_WINDOW)
            .output()?;
        let out_str = String::from_utf8_lossy(&output.stdout);
        
        let mut ssid = "Disconnected".to_string();
        let mut bssid = "00:00:00:00:00:00".to_string();
        let mut signal = "0%".to_string();
        let mut interface = "unknown".to_string();

        for line in out_str.lines() {
            let line = line.trim();
            if let Some((key, value)) = line.split_once(':') {
                let key = key.trim();
                let value = value.trim();
                match key {
                    "SSID" => ssid = value.to_string(),
                    "BSSID" => bssid = value.to_string(),
                    "Signal" => signal = value.to_string(),
                    "Name" => interface = value.to_string(),
                    _ => {}
                }
            }
        }

        // Fallback for Wired/Other remains as before but returns bssid="Ethernet"
        if ssid.is_empty() || ssid == "Disconnected" {
            let ps_output = Command::new("powershell")
                .args(&["-Command", "(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -eq 'Internet' -or $_.IPv6Connectivity -eq 'Internet' } | Select-Object -First 1).Name"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            
            if let Ok(ps_out) = ps_output {
                let profile_name = String::from_utf8_lossy(&ps_out.stdout).trim().to_string();
                if !profile_name.is_empty() {
                    return Ok(WifiInfo { ssid: profile_name.clone(), bssid: "wired".to_string(), signal: "100%".to_string(), interface: profile_name });
                }
            }
            
            return Ok(WifiInfo { ssid: "Ethernet/Other".to_string(), bssid: "wired".to_string(), signal: "100%".to_string(), interface: "primary".to_string() });
        }

        Ok(WifiInfo { ssid, bssid, signal, interface })
    }

    #[cfg(not(windows))]
    {
        Ok(WifiInfo { 
            ssid: "Wired/Other".to_string(), 
            bssid: "00:00:00:00:00:00".to_string(),
            signal: "100%".to_string(), 
            interface: "eth0".to_string() 
        })
    }
}

async fn monitor_connections(
    sync_manager: Arc<SyncManager>,
) -> Result<()> {
    let storage = sync_manager.get_storage();
    
    // Forensic Resume: Load previous connections from SQLite (Item 6.2)
    let mut previous_connections: std::collections::HashSet<String> = match storage.load_state("network_known_conns") {
        Ok(Some(v)) => serde_json::from_value(v).unwrap_or_default(),
        _ => std::collections::HashSet::new(),
    };

    if !previous_connections.is_empty() {
        info!("Forensic Resume: Loaded {} persisted network connections", previous_connections.len());
    }

    loop {
        // Monitor every 10 seconds
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;

        if let Ok(connections) = get_active_connections().await {
            let mut current_hashes = std::collections::HashSet::new();
            let mut new_conns_detected = false;

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
                            "was_offline": !previous_connections.is_empty() // Connection started while offline/stopped
                        }),
                    };
                    sync_manager.queue_event(event);
                    new_conns_detected = true;
                }
                current_hashes.insert(conn_hash);
            }
            
            // Update and Persist state
            previous_connections = current_hashes;
            if new_conns_detected {
                let _ = storage.save_state("network_known_conns", &json!(previous_connections));
            }
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
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    
    let output = Command::new("netstat")
        .args(&["-ano"])
        .creation_flags(CREATE_NO_WINDOW)
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
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    
    let output = Command::new("tasklist")
        .args(&["/FI", &format!("PID eq {}", pid), "/FO", "CSV", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
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

