use anyhow::Result;
use std::path::Path;
use tracing::info;

/// Harden the ACLs on the agent's data directory (`C:\ProgramData\RAV`).
///
/// This is protection through access control, NOT concealment: the folder stays
/// fully visible in Explorer. The goals are (1) a standard (non-admin) user must
/// not be able to delete or wipe the agent's files to evade monitoring, and
/// (2) the logs/captures are readable only by Administrators + SYSTEM. At the same
/// time the user-context Native Messaging Host (which runs as the logged-in user)
/// must still be able to read `config.toml` and read/write its SQLite event queue,
/// so Users keep read + write (create/append) on the root — but NOT delete.
///
/// All steps are best-effort: a failure is logged and ignored so a locked-down or
/// GPO-managed box never prevents the agent from running.
pub fn harden_data_dir_permissions(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }

    #[cfg(windows)]
    {
        use std::process::Command;
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let run = |args: &[&str]| {
            let out = Command::new("icacls")
                .args(args)
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            match out {
                Ok(o) if o.status.success() => true,
                Ok(o) => {
                    tracing::warn!(
                        "icacls {:?} failed: {}",
                        args,
                        String::from_utf8_lossy(&o.stderr).trim()
                    );
                    false
                }
                Err(e) => {
                    tracing::warn!("icacls {:?} could not run: {}", args, e);
                    false
                }
            }
        };

        let root = path.to_string_lossy();

        // 1. SYSTEM + Administrators keep full control (explicit, inheritable).
        run(&[&root, "/grant", "SYSTEM:(OI)(CI)F", "/T", "/C", "/Q"]);
        run(&[&root, "/grant", "*S-1-5-32-544:(OI)(CI)F", "/T", "/C", "/Q"]);

        // 2. Remove any previously-granted broad "Users" rights (older builds granted
        //    Users Full Control, which let a standard user delete the agent's files).
        run(&[&root, "/remove:g", "*S-1-5-32-545", "/T", "/C", "/Q"]);

        // 3. Re-grant Users the minimum the user-context native host needs: read +
        //    write/create (RX,W) but NOT delete. Without DELETE/DC a standard user
        //    cannot remove config.toml or the event-queue DB to break monitoring.
        run(&[&root, "/grant", "*S-1-5-32-545:(OI)(CI)(RX,W)", "/C", "/Q"]);

        // 4. Lock the logs subfolder down to Administrators + SYSTEM only — captured
        //    activity and logs are not readable by the monitored user.
        let logs = path.join("logs");
        if logs.exists() {
            let logs_str = logs.to_string_lossy();
            run(&[&logs_str, "/inheritance:r", "/C", "/Q"]);
            run(&[&logs_str, "/grant", "SYSTEM:(OI)(CI)F", "/T", "/C", "/Q"]);
            run(&[&logs_str, "/grant", "*S-1-5-32-544:(OI)(CI)F", "/T", "/C", "/Q"]);
        }

        info!("Data directory ACLs hardened (Users: read/write, no delete; logs: admin-only): {:?}", path);
    }

    Ok(())
}

/// Report whether the agent's Windows service is still registered.
///
/// Part of the agent's own health/integrity reporting on an openly-deployed,
/// managed service — it detects when the service entry has been removed so the
/// backend can surface a "service missing" alert to admins. It takes no action
/// and never hides anything.
pub fn check_service_present(service_name: &str) -> Result<bool> {
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
                info!("Service health: '{}' is not registered (service entry missing).", service_name);
                return Ok(false);
            }
        }
    }

    Ok(true)
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
