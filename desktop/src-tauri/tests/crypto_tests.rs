//! Test unitari per crypto_fuse (encrypt/decrypt blob).

use axshare_desktop_lib::crypto_fuse::{decrypt_blob, encrypt_blob};

#[test]
fn test_encrypt_decrypt_roundtrip() {
    let key = [0u8; 32];
    let plaintext = b"contenuto segreto AXSHARE desktop";
    let encrypted = encrypt_blob(plaintext, &key).expect("encrypt ok");
    assert!(
        encrypted.len() > 12,
        "encrypted deve essere > 12 bytes (nonce)"
    );
    let decrypted = decrypt_blob(&encrypted, &key).expect("decrypt ok");
    assert_eq!(decrypted, plaintext);
}

#[test]
fn test_wrong_key_fails() {
    let key = [0u8; 32];
    let wrong_key = [1u8; 32];
    let plaintext = b"test data";
    let encrypted = encrypt_blob(plaintext, &key).expect("encrypt ok");
    let result = decrypt_blob(&encrypted, &wrong_key);
    assert!(result.is_err(), "wrong key deve fallire");
}

#[test]
fn test_nonce_is_random() {
    let key = [0u8; 32];
    let plaintext = b"test";
    let enc1 = encrypt_blob(plaintext, &key).unwrap();
    let enc2 = encrypt_blob(plaintext, &key).unwrap();
    assert_ne!(
        &enc1[..12],
        &enc2[..12],
        "nonce deve essere random"
    );
}

#[test]
fn test_tampered_data_fails() {
    let key = [0u8; 32];
    let plaintext = b"original data";
    let mut encrypted = encrypt_blob(plaintext, &key).unwrap();
    let last = encrypted.len() - 1;
    encrypted[last] ^= 0xFF;
    let result = decrypt_blob(&encrypted, &key);
    assert!(result.is_err(), "dato manomesso deve fallire");
}

#[test]
fn test_key_too_short_fails() {
    let short_key = [0u8; 16];
    let result = encrypt_blob(b"test", &short_key);
    assert!(result.is_err());
}
