use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub backend: BackendConfig,
    pub agent: AgentConfig,
    pub encryption: EncryptionConfig,
    pub monitoring: MonitoringConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendConfig {
    pub url: String,
    pub api_key: Option<String>,
    pub enrollment_token: Option<String>,
    pub sync_interval_seconds: u64,
    pub heartbeat_interval_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub agent_id: Option<String>,
    pub organization_id: Option<String>,
    pub hardware_fingerprint: Option<String>,
    pub data_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionConfig {
    pub key_path: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitoringConfig {
    pub usb: UsbMonitoringConfig,
    pub network: NetworkMonitoringConfig,
    #[serde(default)]
    pub screenshots: ScreenshotMonitoringConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbMonitoringConfig {
    pub enabled: bool,
    pub track_file_transfers: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkMonitoringConfig {
    pub enabled: bool,
    pub track_dns: bool,
    pub track_connections: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScreenshotMonitoringConfig {
    pub enabled: bool,
    pub capture_interval_seconds: u64,
    pub compression_quality: u8, // 0-100 for JPEG
    pub format: String, // "jpeg" or "png"
}

impl Default for ScreenshotMonitoringConfig {
    fn default() -> Self {
        ScreenshotMonitoringConfig {
            enabled: true,
            capture_interval_seconds: 120, // 2 minutes
            compression_quality: 85,
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
                    .unwrap_or_else(|_| "http://localhost:8080".to_string()),
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
                    compression_quality: 85, // Good quality, reasonable size
                    format: "jpeg".to_string(),
                },
            },
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

