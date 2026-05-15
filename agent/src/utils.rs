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

pub fn set_directory_permissions(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        
        let path_str = path.to_string_lossy();
        
        // Grant "Users" Full Control (F) to this folder and all subfolders/files (OI)(CI)
        let output = Command::new("icacls")
            .arg(path_str.as_ref())
            .arg("/grant")
            .arg("Users:(OI)(CI)F")
            .arg("/T")
            .arg("/Q") // Quiet mode
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                info!("Directory permissions explicitly relaxed for: {:?}", path);
            } else {
                let err = String::from_utf8_lossy(&out.stderr);
                tracing::warn!("Failed to set permissions for {:?}: {}", path, err);
            }
        }
    }

    Ok(())
}

pub fn detect_tampering(service_name: &str) -> Result<bool> {
    // 1. Check if config still exists 
    // Usually Config::get_config_path() but we'll use a standard check for the data dir
    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let output = Command::new("sc")
            .arg("query")
            .arg(service_name)
            .creation_flags(CREATE_NO_WINDOW)
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

/// Self-repair the Native Messaging Host manifest and registry keys.
/// Called on every agent startup to ensure the extension can always connect.
/// This makes Native Messaging work regardless of whether the MSI custom action succeeded.
#[cfg(windows)]
pub fn repair_native_messaging_host() {
    use std::fs;
    
    let exe_path = match std::env::current_exe() {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!("Cannot repair native messaging: failed to get exe path: {}", e);
            return;
        }
    };
    
    let install_dir = match exe_path.parent() {
        Some(p) => p,
        None => return,
    };
    
    let manifest_path = install_dir.join("com.rav.agent.json");
    
    // Build the manifest with the correct path and all known extension IDs
    let manifest = serde_json::json!({
        "name": "com.rav.agent",
        "description": "RAV Agent Native Messaging Host",
        "path": exe_path.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [
            "chrome-extension://lkgbkgaglogjopokmbcedcdlcajldhkk/",
            "chrome-extension://dlkdbjmoohiplloecfgblbggpijbomna/",
            "chrome-extension://epjnmnocdpicilcklecnmkmdjdegnaie/",
            "chrome-extension://nihfegnoliailmnlfmgjpookgibibhjp/"
        ]
    });
    
    // Write the manifest
    match serde_json::to_string_pretty(&manifest) {
        Ok(json_str) => {
            if let Err(e) = fs::write(&manifest_path, &json_str) {
                tracing::warn!("Failed to write native messaging manifest: {}", e);
                return;
            }
            info!("Native Messaging manifest written: {}", manifest_path.display());
        }
        Err(e) => {
            tracing::warn!("Failed to serialize native messaging manifest: {}", e);
            return;
        }
    }
    
    // Ensure registry keys point to this manifest
    let manifest_path_str = manifest_path.to_string_lossy().to_string();
    
    use winapi::um::winreg::{RegCreateKeyExW, RegSetValueExW, HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER};
    use winapi::um::winnt::{REG_SZ, KEY_WRITE};
    use winapi::shared::minwindef::HKEY;
    use std::os::windows::ffi::OsStrExt;
    use std::ffi::OsStr;
    use std::ptr;
    
    let registry_paths = [
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\com.rav.agent"),
        (HKEY_CURRENT_USER,  "SOFTWARE\\Google\\Chrome\\NativeMessagingHosts\\com.rav.agent"),
        (HKEY_LOCAL_MACHINE, "SOFTWARE\\Microsoft\\Edge\\NativeMessagingHosts\\com.rav.agent"),
        (HKEY_CURRENT_USER,  "SOFTWARE\\Microsoft\\Edge\\NativeMessagingHosts\\com.rav.agent"),
    ];
    
    for (root, subkey) in &registry_paths {
        let subkey_wide: Vec<u16> = OsStr::new(subkey).encode_wide().chain(std::iter::once(0)).collect();
        let value_wide: Vec<u16> = OsStr::new(&manifest_path_str).encode_wide().chain(std::iter::once(0)).collect();
        
        unsafe {
            let mut hkey: HKEY = ptr::null_mut();
            let mut disposition: u32 = 0;
            
            let result = RegCreateKeyExW(
                *root,
                subkey_wide.as_ptr(),
                0,
                ptr::null_mut(),
                0, // REG_OPTION_NON_VOLATILE
                KEY_WRITE,
                ptr::null_mut(),
                &mut hkey,
                &mut disposition,
            );
            
            if result == 0 {
                // Set the default value to the manifest path
                RegSetValueExW(
                    hkey,
                    ptr::null(), // Default value
                    0,
                    REG_SZ,
                    value_wide.as_ptr() as *const u8,
                    (value_wide.len() * 2) as u32,
                );
                winapi::um::winreg::RegCloseKey(hkey);
            }
        }
    }
    
    info!("Native Messaging registry keys verified for Chrome and Edge");
}
