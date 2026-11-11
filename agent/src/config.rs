use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    pub backend: BackendConfig,
    pub agent: AgentConfig,
    pub encryption: EncryptionConfig,
    pub monitoring: MonitoringConfig,
    #[serde(default)]
    pub service: ServiceConfig,
    #[serde(default)]
    pub persistence: PersistenceConfig,
    #[serde(default)]
    pub performance: PerformanceConfig,
}

/// Identity of the Windows service this agent installs and manages.
///
/// This is an openly-identified monitoring agent: the display name and the
/// installer's service description plainly state that it monitors and records
/// user activity for the employer. The internal `service_name` (the SCM key) is
/// deliberately kept stable across product renames so that in-place upgrades of
/// already-deployed agents do not break their service registration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceConfig {
    pub service_name: String,
    pub service_display_name: String,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        ServiceConfig {
            // Internal SCM key — kept stable for upgrade continuity.
            service_name: "AssetTelemetryService".to_string(),
            // What a user sees in services.msc — honest.
            service_display_name: "RAV Monitoring Agent".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceConfig {
    pub cpu_limit_percent: u8,
    pub max_memory_mb: u64,
    pub io_priority: String, // "low", "normal"
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        PerformanceConfig {
            cpu_limit_percent: 5, // Default low impact
            max_memory_mb: 128,
            io_priority: "low".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistenceConfig {
    pub save_interval_minutes: u64,
    pub state_dir: PathBuf,
}

impl Default for PersistenceConfig {
    fn default() -> Self {
        PersistenceConfig {
            save_interval_minutes: 5,
            state_dir: PathBuf::from("state"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendConfig {
    pub url: String,
    pub api_key: Option<String>,
    pub enrollment_token: Option<String>,
    pub sync_interval_seconds: u64,
    pub heartbeat_interval_seconds: u64,
    /// Authenticode thumbprint the auto-update MSI must be signed with. When set, the agent
    /// refuses any downloaded installer that isn't validly signed by this cert. Empty/absent =
    /// signature enforcement off (SHA-256 only). serde default keeps older configs parseable.
    #[serde(default)]
    pub update_signer_thumbprint: Option<String>,
}

impl Default for BackendConfig {
    fn default() -> Self {
        BackendConfig {
            url: "http://172.16.100.41".to_string(),
            api_key: None,
            enrollment_token: None,
            sync_interval_seconds: 10,
            heartbeat_interval_seconds: 60,
            update_signer_thumbprint: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent_id: Option<String>,
    pub organization_id: Option<String>,
    pub hardware_fingerprint: Option<String>,
    pub data_dir: PathBuf,
}

impl Default for AgentConfig {
    fn default() -> Self {
        AgentConfig {
            agent_id: None,
            organization_id: None,
            hardware_fingerprint: None,
            data_dir: PathBuf::from("data"), // Will be substituted by real path in load()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionConfig {
    pub key_path: PathBuf,
}

impl Default for EncryptionConfig {
    fn default() -> Self {
        EncryptionConfig {
            key_path: PathBuf::from("encryption.key"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MonitoringConfig {
    pub usb: UsbMonitoringConfig,
    pub network: NetworkMonitoringConfig,
    #[serde(default)]
    pub screenshots: ScreenshotMonitoringConfig,
    #[serde(default)]
    pub processes: ProcessMonitoringConfig,
    #[serde(default)]
    pub browser: BrowserMonitoringConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessMonitoringConfig {
    pub enabled: bool,
    pub interval_seconds: u64,
}

impl Default for ProcessMonitoringConfig {
    fn default() -> Self {
        ProcessMonitoringConfig {
            enabled: true,
            interval_seconds: 10,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserMonitoringConfig {
    pub enabled: bool,
    pub scrape_interval_minutes: u64,
}

impl Default for BrowserMonitoringConfig {
    fn default() -> Self {
        BrowserMonitoringConfig {
            enabled: true,
            scrape_interval_minutes: 15,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbMonitoringConfig {
    pub enabled: bool,
    pub track_file_transfers: bool,
}

impl Default for UsbMonitoringConfig {
    fn default() -> Self {
        UsbMonitoringConfig {
            enabled: true,
            track_file_transfers: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkMonitoringConfig {
    pub enabled: bool,
    pub track_dns: bool,
    pub track_connections: bool,
}

impl Default for NetworkMonitoringConfig {
    fn default() -> Self {
        NetworkMonitoringConfig {
            enabled: true,
            track_dns: true,
            track_connections: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotMonitoringConfig {
    pub enabled: bool,
    pub capture_interval_seconds: u64,
    pub compression_quality: u8, // 0-100 for JPEG
    /// Downscale captures wider than this (px) before encoding; 0 = no downscaling.
    /// serde default keeps older config.toml files (written without this key) parseable.
    #[serde(default = "default_max_width")]
    pub max_width: u32,
    pub format: String, // "jpeg" or "png"
}

fn default_max_width() -> u32 {
    1280
}

impl Default for ScreenshotMonitoringConfig {
    fn default() -> Self {
        ScreenshotMonitoringConfig {
            enabled: true,
            capture_interval_seconds: 120, // 2 minutes
            compression_quality: 60,
            max_width: default_max_width(),
            format: "jpeg".to_string(),
        }
    }
}



/// Enrollment identity persisted separately from config.toml (which the MSI owns/resets).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentIdentity {
    pub agent_id: Option<String>,
    pub organization_id: Option<String>,
}

impl Config {
    pub fn load() -> Result<Self> {
        // Try to load from config file first
        let config_path = Self::get_config_path()?;
        
        if config_path.exists() {
            let content = fs::read_to_string(&config_path)
                .context("Failed to read config file")?;
            let mut config: Config = toml::from_str(&content)
                .context("Failed to parse config file")?;
            // Restore enrollment identity from the agent-owned identity file. The MSI manages
            // config.toml and RESETS it on upgrade (auto-update), which would wipe agent_id/org_id;
            // identity.toml lives outside MSI control so the session survives upgrades.
            config.overlay_identity();
            return Ok(config);
        }

        // Fallback to environment variables and defaults
        let mut config = Config {
            backend: BackendConfig {
                url: std::env::var("BACKEND_URL")
                    .unwrap_or_else(|_| "http://172.16.100.41".to_string()),
                api_key: std::env::var("AGENT_API_KEY").ok(),
                enrollment_token: std::env::var("AGENT_ENROLLMENT_TOKEN").ok(),
                sync_interval_seconds: std::env::var("AGENT_SYNC_INTERVAL_SECONDS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(10), // Reduced from 30 to 10 seconds for faster syncing
                heartbeat_interval_seconds: std::env::var("AGENT_HEARTBEAT_INTERVAL_SECONDS")
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(60),
                update_signer_thumbprint: std::env::var("AGENT_UPDATE_SIGNER_THUMBPRINT").ok(),
            },
            agent: AgentConfig {
                agent_id: None, // Will be generated on first run
                organization_id: None,
                hardware_fingerprint: None, // Will be generated on first run
                data_dir: Self::get_default_data_dir()?,
            },
            encryption: EncryptionConfig {
                key_path: Self::get_default_data_dir()?.join("encryption.key"),
            },
            monitoring: MonitoringConfig {
                usb: UsbMonitoringConfig {
                    enabled: true,
                    track_file_transfers: true,
                },
                network: NetworkMonitoringConfig {
                    enabled: true,
                    track_dns: true,
                    track_connections: true,
                },
                screenshots: ScreenshotMonitoringConfig {
                    enabled: true,
                    capture_interval_seconds: 120, // Default: 2 minutes
                    compression_quality: 60, // Reduced quality to shrink storage/bandwidth
                    max_width: default_max_width(), // Downscale wide captures to 1280px
                    format: "jpeg".to_string(),
                },
                processes: ProcessMonitoringConfig::default(),
                browser: BrowserMonitoringConfig::default(),
            },
            service: ServiceConfig::default(),
            persistence: PersistenceConfig {
                save_interval_minutes: 30, // Default to 30 mins for safety
                state_dir: Self::get_default_data_dir()?.join("state"),
            },
            performance: PerformanceConfig::default(),
        };

        config.overlay_identity();
        Ok(config)
    }

    fn get_config_path() -> Result<PathBuf> {
        let mut path = Self::get_default_data_dir()?;
        path.push("config.toml");
        Ok(path)
    }

    /// Path to the agent-owned identity file. Kept separate from config.toml because the MSI
    /// resets config.toml on upgrade; this file is never managed by the installer.
    fn identity_path(&self) -> PathBuf {
        self.agent.data_dir.join("identity.toml")
    }

    /// Fill in agent_id / organization_id from identity.toml if config.toml didn't carry them
    /// (e.g. config.toml was reset by an MSI upgrade). config.toml values win when present.
    fn overlay_identity(&mut self) {
        let path = self.identity_path();
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(id) = toml::from_str::<AgentIdentity>(&content) {
                if self.agent.agent_id.is_none() {
                    self.agent.agent_id = id.agent_id;
                }
                if self.agent.organization_id.is_none() {
                    self.agent.organization_id = id.organization_id;
                }
            }
        }
    }

    /// Persist the enrollment identity to identity.toml so it survives MSI upgrades / config resets.
    pub fn save_identity(&self, agent_id: &str, organization_id: &str) -> Result<()> {
        let id = AgentIdentity {
            agent_id: Some(agent_id.to_string()),
            organization_id: Some(organization_id.to_string()),
        };
        let path = self.identity_path();
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&path, toml::to_string(&id).context("serialize identity")?)
            .context("write identity.toml")?;
        Ok(())
    }

    fn get_default_data_dir() -> Result<PathBuf> {
        #[cfg(windows)]
        {
            let mut path = std::env::var("PROGRAMDATA")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("C:\\ProgramData"));
            path.push("RAV");
            Ok(path)
        }

        #[cfg(target_os = "macos")]
        {
            let mut path = PathBuf::from("/Library/Application Support");
            path.push("RAV");
            Ok(path)
        }

        #[cfg(target_os = "linux")]
        {
            Ok(PathBuf::from("/var/lib/rav"))
        }
    }

    pub fn save(&self) -> Result<()> {
        let config_path = Self::get_config_path()?;
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        let content = toml::to_string_pretty(self)
            .context("Failed to serialize config")?;
        fs::write(&config_path, content)
            .context("Failed to write config file")?;
        
        Ok(())
    }
}

