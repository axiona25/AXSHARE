#![allow(dead_code)]
//! Operazioni crittografiche lato Rust per il FUSE filesystem.
//! Speculari al modulo Python backend e al modulo TypeScript frontend.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::rngs::OsRng;
use rand_core::RngCore;

const NONCE_SIZE: usize = 12;
const KEY_SIZE: usize = 32;

/// Decifra un blob AES-256-GCM nel formato [12 nonce][ciphertext+tag]
pub fn decrypt_blob(encrypted: &[u8], key_bytes: &[u8]) -> Result<Vec<u8>, String> {
    if encrypted.len() < NONCE_SIZE {
        return Err("Blob troppo corto".to_string());
    }
    if key_bytes.len() != KEY_SIZE {
        return Err(format!("Chiave deve essere {} bytes", KEY_SIZE));
    }
    let nonce = Nonce::from_slice(&encrypted[..NONCE_SIZE]);
    let ciphertext = &encrypted[NONCE_SIZE..];
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| format!("Decifratura fallita: {}", e))
}

/// Cifra un blob con AES-256-GCM, formato output: [12 nonce][ciphertext+tag]
pub fn encrypt_blob(plaintext: &[u8], key_bytes: &[u8]) -> Result<Vec<u8>, String> {
    if key_bytes.len() != KEY_SIZE {
        return Err(format!("Chiave deve essere {} bytes", KEY_SIZE));
    }
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let key = Key::<Aes256Gcm>::from_slice(key_bytes);
    let cipher = Aes256Gcm::new(key);
    let mut result = nonce_bytes.to_vec();
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Cifratura fallita: {}", e))?;
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

pub fn b64_to_bytes(s: &str) -> Result<Vec<u8>, String> {
    B64.decode(s).map_err(|e| e.to_string())
}

pub fn bytes_to_b64(b: &[u8]) -> String {
    B64.encode(b)
}
