//! Cifra/decifra file locali al logout/login usando LocalDb + crypto_fuse.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;

use crate::local_db::LocalDb;
use crate::xattr_manager;

/// Al logout: cifra tutti i file con status=plain (scrive .axshare, aggiorna DB).
pub async fn encrypt_all_local_files(db: &LocalDb) {
    let files = db.get_by_status("plain");
    log::info!("[PROTECTOR] Cifro {} file locali...", files.len());

    for entry in files {
        let path = std::path::Path::new(&entry.local_path);
        if !path.exists() {
            let _ = db.remove(&entry.local_path);
            continue;
        }

        let data = match std::fs::read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let key = match B64.decode(&entry.file_key_base64) {
            Ok(k) => k,
            Err(_) => continue,
        };
        let encrypted = match crate::crypto_fuse::encrypt_blob(&data, &key) {
            Ok(e) => e,
            Err(_) => continue,
        };

        let new_path_str = format!("{}.axshare", entry.local_path);
        let new_path = std::path::Path::new(&new_path_str);

        if std::fs::write(new_path, &encrypted).is_ok() {
            let _ = xattr_manager::set_axshare_xattr(
                new_path,
                &entry.file_id,
                &entry.file_key_base64,
                &entry.original_name,
            );
            let _ = std::fs::remove_file(path);
            let _ = db.update_status(&entry.local_path, &new_path_str, "encrypted");
            log::info!(
                "[PROTECTOR] Cifrato: {} -> {}",
                entry.local_path,
                new_path_str
            );
        }
    }
}

/// Al login: decifra tutti i file con status=encrypted (rimuove .axshare, aggiorna DB).
pub async fn decrypt_all_local_files(db: &LocalDb) {
    let files = db.get_by_status("encrypted");
    log::info!("[PROTECTOR] Decifro {} file locali...", files.len());

    for entry in files {
        let path = std::path::Path::new(&entry.local_path);
        if !path.exists() {
            let _ = db.remove(&entry.local_path);
            continue;
        }

        let data = match std::fs::read(path) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let key = match B64.decode(&entry.file_key_base64) {
            Ok(k) => k,
            Err(_) => continue,
        };
        let plain = match crate::crypto_fuse::decrypt_blob(&data, &key) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let original_path_str = entry
            .local_path
            .strip_suffix(".axshare")
            .unwrap_or(&entry.local_path)
            .to_string();
        let original_path = std::path::Path::new(&original_path_str);

        if std::fs::write(original_path, &plain).is_ok() {
            let _ = xattr_manager::set_axshare_xattr(
                original_path,
                &entry.file_id,
                &entry.file_key_base64,
                &entry.original_name,
            );
            let _ = std::fs::remove_file(path);
            let _ = db.update_status(&entry.local_path, &original_path_str, "plain");
            log::info!(
                "[PROTECTOR] Decifrato: {} -> {}",
                entry.local_path,
                original_path_str
            );
        }
    }
}
