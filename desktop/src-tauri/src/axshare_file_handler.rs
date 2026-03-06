//! Gestione apertura file .axshare: decifra, apre con app nativa, cancella temp dopo 60s.

use std::path::Path;

use crate::crypto_fuse;

/// Legge un file .axshare (formato [4 key_len LE][key][encrypted]), decifra,
/// scrive in un temp, apre con l'app nativa, programma cancellazione dopo 60s.
pub fn open_axshare_file(path: &Path) {
    let path = match path.canonicalize() {
        Ok(p) => p,
        Err(_) => path.to_path_buf(),
    };

    if path.extension().map(|e| e != "axshare").unwrap_or(true) {
        return;
    }

    let content = match std::fs::read(&path) {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[AXSHARE] read error {}: {}", path.display(), e);
            return;
        }
    };

    if content.len() < 4 + 32 {
        log::warn!("[AXSHARE] file too short: {}", path.display());
        return;
    }

    let key_len = u32::from_le_bytes(content[0..4].try_into().unwrap()) as usize;
    if key_len != 32 || content.len() < 4 + key_len {
        log::warn!("[AXSHARE] invalid key_len or content: {}", path.display());
        return;
    }

    let key_bytes = &content[4..4 + key_len];
    let encrypted = &content[4 + key_len..];

    let plain = match crypto_fuse::decrypt_blob(encrypted, key_bytes) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("[AXSHARE] decrypt error {}: {}", path.display(), e);
            return;
        }
    };

    let original_stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let temp_path = std::env::temp_dir()
        .join(format!("axshare_open_{}_{}", unique, original_stem));

    if std::fs::write(&temp_path, &plain).is_err() {
        log::warn!("[AXSHARE] write temp error: {}", temp_path.display());
        return;
    }

    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(&temp_path).spawn();

    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("cmd")
        .args(["/C", "start", "", temp_path.to_str().unwrap_or("")])
        .spawn();

    #[cfg(target_os = "linux")]
    let _ = std::process::Command::new("xdg-open").arg(&temp_path).spawn();

    let tp = temp_path.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
        let _ = std::fs::remove_file(&tp);
        log::info!("[AXSHARE] temp rimosso: {}", tp.display());
    });
}
