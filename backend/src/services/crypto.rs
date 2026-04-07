use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce
};
use base64::{Engine as _, engine::general_purpose};
use anyhow::{Result, Context, anyhow};
use rand::{RngCore, thread_rng};

pub struct EncryptionService {
    key: [u8; 32],
}

impl EncryptionService {
    pub fn new(key_str: &str) -> Self {
        let mut key = [0u8; 32];
        let bytes = key_str.as_bytes();
        let len = bytes.len().min(32);
        key[..len].copy_from_slice(&bytes[..len]);
        Self { key }
    }

    pub fn encrypt(&self, data: &str) -> Result<String> {
        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| anyhow!("Invalid key"))?;
        
        let mut nonce_bytes = [0u8; 12];
        thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        let ciphertext = cipher.encrypt(nonce, data.as_bytes().as_ref())
            .map_err(|e| anyhow!("Encryption failure: {}", e))?;

        // Format: nonce(12) + ciphertext
        let mut combined = nonce_bytes.to_vec();
        combined.extend_from_slice(&ciphertext);

        Ok(general_purpose::STANDARD.encode(combined))
    }

    pub fn decrypt(&self, encrypted_base64: &str) -> Result<String> {
        let combined = general_purpose::STANDARD.decode(encrypted_base64)
            .context("Invalid base64 payload")?;

        if combined.len() < 12 {
            return Err(anyhow!("Payload too short"));
        }

        let cipher = Aes256Gcm::new_from_slice(&self.key).map_err(|_| anyhow!("Invalid key"))?;
        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref())
            .map_err(|e| anyhow!("Decryption failure: {}", e))?;

        String::from_utf8(plaintext).context("Decrypted data is not valid UTF-8")
    }
}
