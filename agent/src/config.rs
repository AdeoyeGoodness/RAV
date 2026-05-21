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
    pub stealth: StealthConfig,
    #[serde(default)]
    pub persistence: PersistenceConfig,
    #[serde(default)]
    pub performance: PerformanceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StealthConfig {
    pub enabled: bool,
    pub hide_files: bool,
    pub service_name: String,
    pub service_display_name: String,
    pub process_name: Option<String>,
    pub tamper_detection: bool,
}

impl Default for StealthConfig {
    fn default() -> Self {
        StealthConfig {
            enabled: false,
            hide_files: false,
            service_name: "RAV-Agent".to_string(),
            service_display_name: "RAV Enterprise Monitor".to_string(),
            process_name: None,
            tamper_detection: false,
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
            url: "https://rav.handy.boats".to_string(),
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



impl Config {
    pub fn load() -> Result<Self> {
        // Try to load from config file first
        let config_path = Self::get_config_path()?;
        
        if config_path.exists() {
            let content = fs::read_to_string(&config_path)
                .context("Failed to read config file")?;
            let config: Config = toml::from_str(&content)
                .context("Failed to parse config file")?;
            return Ok(config);
        }

        // Fallback to environment variables and defaults
        let config = Config {
            backend: BackendConfig {
                url: std::env::var("BACKEND_URL")
                    .unwrap_or_else(|_| "https://rav.handy.boats".to_string()),
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
            stealth: StealthConfig::default(),
            persistence: PersistenceConfig {
                save_interval_minutes: 30, // Default to 30 mins for safety
                state_dir: Self::get_default_data_dir()?.join("state"),
            },
            performance: PerformanceConfig::default(),
        };

        Ok(config)
    }

    fn get_config_path() -> Result<PathBuf> {
        let mut path = Self::get_default_data_dir()?;
        path.push("config.toml");
        Ok(path)
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

