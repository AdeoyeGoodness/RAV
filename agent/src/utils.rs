use anyhow::Result;
use std::path::Path;
use tracing::info;

#[cfg(windows)]
use winapi::um::fileapi::SetFileAttributesW;
#[cfg(windows)]
use winapi::um::winnt::{FILE_ATTRIBUTE_HIDDEN, FILE_ATTRIBUTE_SYSTEM};
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

pub fn hide_file(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    #[cfg(windows)]
    {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let result = unsafe {
            SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)
        };

        if result == 0 {
            anyhow::bail!("Failed to set file attributes for stealth: {}", std::io::Error::last_os_error());
        }
        info!("Stealth: File/Directory hidden and marked as system: {:?}", path);
    }

    Ok(())
}

pub fn detect_tampering(service_name: &str) -> Result<bool> {
    // 1. Check if config still exists 
    // Usually Config::get_config_path() but we'll use a standard check for the data dir
    #[cfg(windows)]
    {
        use std::process::Command;
        let output = Command::new("sc")
            .arg("query")
            .arg(service_name)
            .output();
            
        if let Ok(out) = output {
            if !out.status.success() {
                info!("Tamper Alert: Service '{}' is missing or could not be queried.", service_name);
                return Ok(true);
            }
        }
    }
    
    Ok(false)
}
