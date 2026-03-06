//! Watcher su Desktop/Documents/Downloads: riconosce file AXSHARE tramite hash SHA-256
//! (gli xattr non vengono copiati dal volume WebDAV).

use std::sync::Arc;

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

use crate::local_db::{LocalDb, LocalFileEntry};

const MAX_FILE_SIZE_FOR_HASH: usize = 50 * 1024 * 1024; // 50 MB

fn try_register_file(db: &LocalDb, path: &std::path::Path) {
    if !path.is_file() {
        return;
    }
    if path
        .extension()
        .map(|e| e == "axshare")
        .unwrap_or(false)
    {
        return;
    }
    let path_str = path.to_string_lossy();
    if path_str.contains("axshare_webdav") {
        return;
    }

    let data = match std::fs::read(path) {
        Ok(d) => d,
        Err(_) => return,
    };
    if data.is_empty() {
        return;
    }
    if data.len() > MAX_FILE_SIZE_FOR_HASH {
        return;
    }

    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = format!("{:x}", hasher.finalize());

    let Some(entry) = db.find_by_hash(&hash) else {
        return;
    };

    let new_path = path.to_string_lossy().to_string();
    let new_entry = LocalFileEntry {
        local_path: new_path.clone(),
        file_id: entry.file_id,
        file_key_base64: entry.file_key_base64,
        original_name: entry.original_name,
        content_hash: Some(hash),
        status: "plain".to_string(),
    };

    if db.upsert(&new_entry).is_ok() {
        log::info!("[WATCHER] Tracciato per hash: {}", new_path);
    }
}

/// Avvia il watcher su Desktop, Documents, Downloads. Esegue in un thread dedicato.
pub fn start_local_file_watcher(db: Arc<LocalDb>) {
    let home = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let watch_dirs: Vec<std::path::PathBuf> = vec![
        home.join("Desktop"),
        home.join("Documents"),
        home.join("Downloads"),
    ];

    std::thread::spawn(move || {
        let db_clone = db.clone();
        let mut watcher = match RecommendedWatcher::new(
            move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => {
                            for path in &event.paths {
                                try_register_file(db_clone.as_ref(), path);
                            }
                        }
                        _ => {}
                    }
                }
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                log::error!("[WATCHER] Watcher fallito: {}", e);
                return;
            }
        };

        for dir in &watch_dirs {
            if dir.exists() {
                if watcher.watch(dir, RecursiveMode::NonRecursive).is_ok() {
                    log::info!("[WATCHER] Watching: {:?}", dir);
                }
            }
        }

        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    });
}
