//! Cifra al logout / decifra al login per file copiati dal disco virtuale.
//! Estensione .axs, icone custom su macOS, formato AES-256-GCM compatibile con backend.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::path::Path;

use crate::crypto_fuse;
use crate::local_db::LocalDb;
use crate::xattr_manager;

const AXS_SUFFIX: &str = ".axs";

/// Icona SVG in base all'estensione (frontend/public/icons: axs_*.svg, folder_blue_locked.svg).
fn icon_name_for_file(original_name: &str) -> &'static str {
    let lower = original_name.to_lowercase();
    if lower.ends_with(".pdf") {
        "axs_pdf.svg"
    } else if lower.ends_with(".docx") || lower.ends_with(".doc") {
        "axs_docx.svg"
    } else if lower.ends_with(".xlsx") || lower.ends_with(".xls") {
        "axs_xlsx.svg"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "axs_jpg.svg"
    } else if lower.ends_with(".png") {
        "axs_png.svg"
    } else if lower.ends_with(".gif") {
        "axs_gif.svg"
    } else if lower.ends_with(".mp4") {
        "axs_mp4.svg"
    } else if lower.ends_with(".mp3") {
        "axs_mp3.svg"
    } else if lower.ends_with(".zip") || lower.ends_with(".rar") {
        "axs_zip.svg"
    } else if lower.ends_with(".txt") {
        "axs_txt.svg"
    } else if lower.ends_with(".pptx") || lower.ends_with(".ppt") {
        "axs_pptx.svg"
    } else if lower.ends_with(".csv") {
        "axs_csv.svg"
    } else {
        "axs_axs.svg"
    }
}

/// Per cartelle (se un giorno si tracciano): folder_blue_locked.svg
#[allow(dead_code)]
fn icon_name_for_folder() -> &'static str {
    "folder_blue_locked.svg"
}

#[cfg(target_os = "macos")]
fn set_custom_icon(file_path: &Path, icon_path: &Path) {
    let file_str = file_path.to_string_lossy();

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let tmp_dir = std::env::temp_dir().join(format!("axshare_icon_{}", millis));

    if std::fs::create_dir_all(&tmp_dir).is_err() {
        println!(
            "[LOCAL_ENCRYPTOR] set_icon: create_dir FALLITO, skip icona per {}",
            file_str
        );
        return;
    }

    let tmp_png = tmp_dir.join("icon.png");
    let icon_str = icon_path.to_string_lossy();
    let tmp_png_str = tmp_png.to_string_lossy();

    let rsvg_ok = std::process::Command::new("rsvg-convert")
        .args([
            "-w", "512",
            "-h", "512",
            "--keep-aspect-ratio",
            "-o", &tmp_png_str.as_ref(),
            &icon_str.as_ref(),
        ])
        .output()
        .as_ref()
        .map(|o| o.status.success())
        .unwrap_or(false);

    if rsvg_ok && tmp_png.exists() {
        println!("[LOCAL_ENCRYPTOR] set_icon: rsvg-convert OK -> {}", tmp_png.display());
    } else {
        println!("[LOCAL_ENCRYPTOR] set_icon: rsvg-convert FALLITO");
        let convert_ok = std::process::Command::new("convert")
            .args([
                "-background", "none",
                "-resize", "512x512",
                &icon_str.as_ref(),
                &tmp_png_str.as_ref(),
            ])
            .output()
            .as_ref()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if convert_ok && tmp_png.exists() {
            println!("[LOCAL_ENCRYPTOR] set_icon: convert OK -> {}", tmp_png.display());
        } else {
            println!("[LOCAL_ENCRYPTOR] set_icon: convert FALLITO, skip icona per {}", file_str);
            let _ = std::fs::remove_dir_all(&tmp_dir);
            return;
        }
    }

    let out = std::process::Command::new("fileicon")
        .args([
            "set",
            &file_path.to_string_lossy().as_ref(),
            &tmp_png.to_string_lossy().as_ref(),
        ])
        .output();

    if out.as_ref().map(|o| o.status.success()).unwrap_or(false) {
        println!("[LOCAL_ENCRYPTOR] set_icon: fileicon OK per {}", file_str);
    } else {
        let stderr = out
            .as_ref()
            .map(|o| String::from_utf8_lossy(&o.stderr).to_string())
            .unwrap_or_default();
        println!("[LOCAL_ENCRYPTOR] set_icon: fileicon FALLITO: {}", stderr);
    }

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[cfg(not(target_os = "macos"))]
fn set_custom_icon(_file_path: &Path, _icon_path: &Path) {}

/// Al logout: cifra tutti i file con status=plain (scrive .axs, xattr, icona, aggiorna DB).
pub async fn encrypt_local_files(db: &LocalDb, icon_dir: Option<&Path>) {
    let files = db.get_by_status("plain");
    println!("[LOCAL_ENCRYPTOR] encrypt_local_files: {} voci status=plain", files.len());
    log::info!("[LOCAL_ENCRYPTOR] Cifro {} file locali (.axs)...", files.len());

    for entry in files {
        // Salta file del disco virtuale WebDAV
        if entry.local_path.contains("axshare_webdav")
            || entry.local_path.contains("/var/folders/")
            || entry.local_path.contains("/tmp/")
        {
            println!("[LOCAL_ENCRYPTOR] Skip file WebDAV: {}", entry.local_path);
            continue;
        }
        if entry.local_path.ends_with(AXS_SUFFIX) {
            continue;
        }
        println!("[LOCAL_ENCRYPTOR] Cifrando: {}", entry.local_path);
        let path = Path::new(&entry.local_path);
        if !path.exists() {
            let _ = db.remove(&entry.local_path);
            println!("[LOCAL_ENCRYPTOR] ERRORE: file non esiste, rimosso da DB");
            continue;
        }

        let data = match std::fs::read(path) {
            Ok(d) => d,
            Err(e) => {
                log::warn!(
                    "[LOCAL_ENCRYPTOR] Lettura fallita {}: {}",
                    entry.local_path,
                    e
                );
                println!("[LOCAL_ENCRYPTOR] ERRORE: lettura fallita {}", e);
                continue;
            }
        };
        let key = match B64.decode(&entry.file_key_base64) {
            Ok(k) => k,
            Err(e) => {
                log::warn!(
                    "[LOCAL_ENCRYPTOR] Base64 key fallita {}: {}",
                    entry.local_path,
                    e
                );
                println!("[LOCAL_ENCRYPTOR] ERRORE: base64 key {}", e);
                continue;
            }
        };
        let encrypted = match crypto_fuse::encrypt_blob(&data, &key) {
            Ok(e) => e,
            Err(e) => {
                log::warn!(
                    "[LOCAL_ENCRYPTOR] Cifratura fallita {}: {}",
                    entry.local_path,
                    e
                );
                println!("[LOCAL_ENCRYPTOR] ERRORE: cifratura {}", e);
                continue;
            }
        };

        let new_path_str = format!("{}{}", entry.local_path, AXS_SUFFIX);
        let new_path = Path::new(&new_path_str);

        if let Err(e) = std::fs::write(new_path, &encrypted) {
            log::warn!(
                "[LOCAL_ENCRYPTOR] Scrittura .axs fallita {}: {}",
                new_path_str,
                e
            );
            println!("[LOCAL_ENCRYPTOR] ERRORE: scrittura .axs {}", e);
            continue;
        }
        if let Err(e) = xattr_manager::set_axshare_xattr(
            new_path,
            &entry.file_id,
            &entry.file_key_base64,
            &entry.original_name,
        ) {
            log::warn!("[LOCAL_ENCRYPTOR] xattr fallito {}: {}", new_path_str, e);
        }
        // Verifica che .axs esista e sia valido PRIMA di eliminare l'originale
        if new_path.exists() && new_path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            if let Err(e) = std::fs::remove_file(path) {
                log::warn!(
                    "[LOCAL_ENCRYPTOR] remove originale fallito {}: {}",
                    entry.local_path,
                    e
                );
            }
        } else {
            log::warn!(
                "[LOCAL_ENCRYPTOR] .axs non valido, originale NON eliminato: {}",
                entry.local_path
            );
            let _ = std::fs::remove_file(new_path);
            continue;
        }
        if let Some(icon_dir) = icon_dir {
            let icon_name = icon_name_for_file(&entry.original_name);
            let icon_path = icon_dir.join(icon_name);
            if icon_path.exists() {
                set_custom_icon(new_path, &icon_path);
            }
        }
        if let Err(e) = db.update_status(&entry.local_path, &new_path_str, "encrypted") {
            log::warn!(
                "[LOCAL_ENCRYPTOR] update_status fallito {}: {}",
                entry.local_path,
                e
            );
            println!("[LOCAL_ENCRYPTOR] ERRORE: update_status {}", e);
        } else {
            log::info!(
                "[LOCAL_ENCRYPTOR] Cifrato: {} -> {}",
                entry.local_path,
                new_path_str
            );
            println!("[LOCAL_ENCRYPTOR] OK cifrato: {} -> {}", entry.local_path, new_path_str);
        }
    }
}

/// Al login: decifra tutti i file con status=encrypted (rimuove .axs, aggiorna DB).
/// Il file decifrato non riceve icona custom (ripristino sistema).
pub async fn decrypt_local_files(db: &LocalDb, _icon_dir: Option<&Path>) {
    let files = db.get_by_status("encrypted");
    println!("[LOCAL_ENCRYPTOR] decrypt_local_files: {} voci status=encrypted", files.len());
    log::info!("[LOCAL_ENCRYPTOR] Decifro {} file locali (.axs)...", files.len());

    for entry in files {
        // Non decifrare mai file dentro axshare_webdav (li gestisce il WebDAV)
        if entry.local_path.contains("axshare_webdav")
            || entry.local_path.contains("/var/folders/")
            || entry.local_path.contains("/tmp/")
        {
            println!("[LOCAL_ENCRYPTOR] Skip file WebDAV: {}", entry.local_path);
            continue;
        }
        if !entry.local_path.ends_with(AXS_SUFFIX) {
            continue;
        }
        println!("[LOCAL_ENCRYPTOR] Decifrando: {}", entry.local_path);
        let path = Path::new(&entry.local_path);
        if !path.exists() {
            let _ = db.remove(&entry.local_path);
            println!("[LOCAL_ENCRYPTOR] ERRORE: .axs non esiste, rimosso da DB");
            continue;
        }

        let data = match std::fs::read(path) {
            Ok(d) => d,
            Err(e) => {
                log::warn!(
                    "[LOCAL_ENCRYPTOR] Lettura .axs fallita {}: {}",
                    entry.local_path,
                    e
                );
                println!("[LOCAL_ENCRYPTOR] ERRORE: lettura .axs {}", e);
                continue;
            }
        };
        let key = match B64.decode(&entry.file_key_base64) {
            Ok(k) => k,
            Err(e) => {
                log::warn!(
                    "[LOCAL_ENCRYPTOR] Base64 key fallita {}: {}",
                    entry.local_path,
                    e
                );
                println!("[LOCAL_ENCRYPTOR] ERRORE: base64 key {}", e);
                continue;
            }
        };
        let plain = match crypto_fuse::decrypt_blob(&data, &key) {
            Ok(p) => p,
            Err(e) => {
                log::warn!(
                    "[LOCAL_ENCRYPTOR] Decifratura fallita {}: {}",
                    entry.local_path,
                    e
                );
                println!("[LOCAL_ENCRYPTOR] ERRORE: decifratura {}", e);
                continue;
            }
        };

        let original_path_str = entry
            .local_path
            .strip_suffix(AXS_SUFFIX)
            .unwrap_or(entry.local_path.as_str())
            .to_string();
        let original_path = Path::new(&original_path_str);

        if let Err(e) = std::fs::write(original_path, &plain) {
            log::warn!(
                "[LOCAL_ENCRYPTOR] Scrittura decifrato fallita {}: {}",
                original_path_str,
                e
            );
            println!("[LOCAL_ENCRYPTOR] ERRORE: scrittura decifrato {}", e);
            continue;
        }
        if let Err(e) = xattr_manager::set_axshare_xattr(
            original_path,
            &entry.file_id,
            &entry.file_key_base64,
            &entry.original_name,
        ) {
            log::warn!("[LOCAL_ENCRYPTOR] xattr fallito {}: {}", original_path_str, e);
        }
        // Rimuovi .axs solo se il file decifrato esiste e ha dimensione > 0
        if original_path.exists() && original_path.metadata().map(|m| m.len() > 0).unwrap_or(false) {
            if let Err(e) = std::fs::remove_file(path) {
                log::warn!(
                    "[LOCAL_ENCRYPTOR] Rimozione .axs fallita {}: {}",
                    entry.local_path,
                    e
                );
            }
        } else {
            log::warn!(
                "[LOCAL_ENCRYPTOR] file decifrato non valido, .axs NON eliminato: {}",
                entry.local_path
            );
            let _ = std::fs::remove_file(original_path);
            continue;
        }
        if let Err(e) = db.update_status(&entry.local_path, &original_path_str, "plain") {
            log::warn!(
                "[LOCAL_ENCRYPTOR] update_status fallito {}: {}",
                entry.local_path,
                e
            );
            println!("[LOCAL_ENCRYPTOR] ERRORE: update_status {}", e);
        } else {
            log::info!(
                "[LOCAL_ENCRYPTOR] Decifrato: {} -> {}",
                entry.local_path,
                original_path_str
            );
            println!("[LOCAL_ENCRYPTOR] OK decifrato: {} -> {}", entry.local_path, original_path_str);
        }
    }
}
