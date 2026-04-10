use anyhow::{Context, Result};
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;

use crate::config::Config;

const KEY_SIZE: usize = 32; // 256 bits
const NONCE_SIZE: usize = 12; // 96 bits for GCM

static ENCRYPTION_KEY: std::sync::OnceLock<Aes256Gcm> = std::sync::OnceLock::new();

pub fn initialize(config: &Config) -> Result<()> {
    let key = load_or_generate_key(&config.encryption.key_path)?;
    ENCRYPTION_KEY.set(key).map_err(|_| anyhow::anyhow!("Encryption key already initialized"))?;
    Ok(())
}

#[cfg(windows)]
pub fn protect(data: &[u8]) -> Result<Vec<u8>> {
    use winapi::um::dpapi::CryptProtectData;
    use winapi::um::wincrypt::DATA_BLOB;
    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;
    use std::ptr;

    let mut input = DATA_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut _,
    };
    let mut output = DATA_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    let result = unsafe {
        CryptProtectData(
            &mut input,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };

    if result == 0 {
        return Err(anyhow::anyhow!("DPAPI CryptProtectData failed"));
    }

    let vec = unsafe {
        std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
    };
    unsafe {
        winapi::um::winbase::LocalFree(output.pbData as *mut _);
    }
    Ok(vec)
}

#[cfg(windows)]
pub fn unprotect(data: &[u8]) -> Result<Vec<u8>> {
    use winapi::um::dpapi::CryptUnprotectData;
    use winapi::um::wincrypt::DATA_BLOB;
    const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;
    use std::ptr;

    let mut input = DATA_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut _,
    };
    let mut output = DATA_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    };

    let result = unsafe {
        CryptUnprotectData(
            &mut input,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
    };

    if result == 0 {
        return Err(anyhow::anyhow!("DPAPI CryptUnprotectData failed"));
    }

    let vec = unsafe {
        std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec()
    };
    unsafe {
        winapi::um::winbase::LocalFree(output.pbData as *mut _);
    }
    Ok(vec)
}

fn load_or_generate_key(key_path: &Path) -> Result<Aes256Gcm> {
    // SECURITY: Prevent Path Traversal
    for component in key_path.components() {
        if matches!(component, std::path::Component::ParentDir) {
            anyhow::bail!("Security Violation: Encryption key path cannot contain '..'");
        }
    }

    let key_bytes = if key_path.exists() {
        // Load existing key
        let stored_key = fs::read(key_path)
            .context("Failed to read encryption key file")?;
        
        // Use DPAPI to decrypt the master key on Windows
        #[cfg(windows)]
        {
            unprotect(&stored_key).context("Failed to decrypt master key via DPAPI")?
        }
        #[cfg(not(windows))]
        {
            stored_key
        }
    } else {
        // Generate new key
        let key: [u8; KEY_SIZE] = Aes256Gcm::generate_key(&mut OsRng).into();
        let key_vec = key.to_vec();
        
        // Ensure parent directory exists
        if let Some(parent) = key_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        // Protect the key with DPAPI before storing on Windows
        #[cfg(windows)]
        let data_to_store = protect(&key_vec).context("Failed to encrypt master key via DPAPI")?;
        #[cfg(not(windows))]
        let data_to_store = key_vec.clone();

        fs::write(key_path, &data_to_store)
            .context("Failed to write protected encryption key file")?;
        
        // Set restrictive permissions (Unix only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(key_path)?.permissions();
            perms.set_mode(0o600); // rw-------
            fs::set_permissions(key_path, perms)?;
        }
        
        key_vec
    };

    if key_bytes.len() != KEY_SIZE {
        anyhow::bail!("Invalid key size: expected {} bytes, got {}", KEY_SIZE, key_bytes.len());
    }

    let key = Key::<Aes256Gcm>::from_slice(&key_bytes);
    Ok(Aes256Gcm::new(key))
}

pub fn encrypt_data(data: &[u8]) -> Result<Vec<u8>> {
    let cipher = ENCRYPTION_KEY.get()
        .ok_or_else(|| anyhow::anyhow!("Encryption not initialized"))?;
    
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, data)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;
    
    // Prepend nonce to ciphertext
    let mut result = nonce.to_vec();
    result.extend_from_slice(&ciphertext);
    
    Ok(result)
}

pub fn decrypt_data(encrypted_data: &[u8]) -> Result<Vec<u8>> {
    let cipher = ENCRYPTION_KEY.get()
        .ok_or_else(|| anyhow::anyhow!("Encryption not initialized"))?;
    
    if encrypted_data.len() < NONCE_SIZE {
        anyhow::bail!("Invalid encrypted data: too short");
    }
    
    let nonce = Nonce::from_slice(&encrypted_data[..NONCE_SIZE]);
    let ciphertext = &encrypted_data[NONCE_SIZE..];
    
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))?;
    
    Ok(plaintext)
}

pub fn hash_data(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

pub fn hash_file(path: &Path) -> Result<String> {
    let data = fs::read(path)
        .context("Failed to read file for hashing")?;
    Ok(hash_data(&data))
}

