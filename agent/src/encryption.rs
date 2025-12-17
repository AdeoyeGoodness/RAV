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

fn load_or_generate_key(key_path: &Path) -> Result<Aes256Gcm> {
    let key_bytes = if key_path.exists() {
        // Load existing key
        let encrypted_key = fs::read(key_path)
            .context("Failed to read encryption key file")?;
        
        // In production, this should decrypt the key using a master key
        // For now, we'll assume the key is stored securely
        if encrypted_key.len() != KEY_SIZE {
            anyhow::bail!("Invalid key size");
        }
        
        encrypted_key
    } else {
        // Generate new key
        let key_bytes: [u8; KEY_SIZE] = Aes256Gcm::generate_key(&mut OsRng).into();
        
        // Ensure parent directory exists
        if let Some(parent) = key_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        // In production, encrypt this key with a master key before storing
        fs::write(key_path, &key_bytes)
            .context("Failed to write encryption key file")?;
        
        // Set restrictive permissions (Unix only)
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(key_path)?.permissions();
            perms.set_mode(0o600); // rw-------
            fs::set_permissions(key_path, perms)?;
        }
        
        key_bytes.to_vec()
    };

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

