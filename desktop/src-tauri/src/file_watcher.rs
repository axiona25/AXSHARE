//! Monitora file temp aperti da AXSHARE per auto-versioning al salvataggio.
//! Ignora file temporanei di Office (~$, .~).
//! Invia file-modified solo se il contenuto è cambiato (hash diverso da apertura).

use notify::{Event, EventKind, RecursiveMode, Watcher};
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

/// Normalizza path per confronto (separatori, es. Windows backslash).
fn normalize_path_str(p: &str) -> String {
    p.replace('\\', "/")
}

/// Hash SHA-256 del file (per rilevare modifiche reali, non solo eventi di accesso).
fn hash_file(path: &str) -> Option<Vec<u8>> {
    let data = fs::read(path).ok()?;
    let mut hasher = Sha256::new();
    hasher.update(&data);
    Some(hasher.finalize().to_vec())
}

#[derive(Clone, Debug)]
pub struct WatchedFile {
    pub file_id: String,
    pub temp_path: String,
    /// Hash del contenuto al momento dell'apertura; inviamo evento solo se cambia.
    pub initial_hash: Vec<u8>,
    pub last_modified: Instant,
    pub last_sent: Option<Instant>,
    pub debounce_ms: u64,
}

/// Ignora file temporanei di Word/Office (~$nome.docx, .~lock-nome)
fn is_office_temp_path(path_str: &str) -> bool {
    let name = Path::new(path_str)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    name.contains("~$") || name.starts_with(".~")
}

pub struct FileWatcher {
    watched: Arc<Mutex<HashMap<String, WatchedFile>>>,
    tx: mpsc::Sender<WatchedFile>,
}

impl FileWatcher {
    pub fn new(tx: mpsc::Sender<WatchedFile>) -> Self {
        Self {
            watched: Arc::new(Mutex::new(HashMap::new())),
            tx,
        }
    }

    pub fn watch_file(&self, file_id: String, temp_path: String) {
        let initial_hash = hash_file(&temp_path).unwrap_or_default();
        let mut map = self.watched.lock().unwrap();
        map.insert(
            temp_path.clone(),
            WatchedFile {
                file_id,
                temp_path,
                initial_hash,
                last_modified: Instant::now(),
                last_sent: None,
                debounce_ms: 2000,
            },
        );
    }

    pub fn unwatch_file(&self, temp_path: &str) {
        let mut map = self.watched.lock().unwrap();
        map.remove(temp_path);
    }

    pub fn start(&self) {
        let watched = self.watched.clone();
        let tx = self.tx.clone();
        let debounce = Duration::from_millis(2000);
        let check_interval = Duration::from_millis(500);

        std::thread::spawn(move || {
            let watched_clone = watched.clone();
            let mut watcher = match notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    match &event.kind {
                        EventKind::Modify(_) | EventKind::Create(_) => {}
                        _ => return,
                    }
                    for path in &event.paths {
                        let path_str = path.to_string_lossy().to_string();
                        if is_office_temp_path(&path_str) {
                            continue;
                        }
                        let mut map = watched_clone.lock().unwrap();
                        let path_norm = normalize_path_str(&path_str);
                        for (_key, wf) in map.iter_mut() {
                            if normalize_path_str(&wf.temp_path) == path_norm {
                                wf.last_modified = Instant::now();
                                break;
                            }
                        }
                    }
                }
            }) {
                Ok(w) => w,
                Err(e) => {
                    log::error!("[FILE_WATCHER] Impossibile creare watcher: {}", e);
                    return;
                }
            };

            let temp_dir = std::env::temp_dir().join("axshare_temp");
            if let Err(e) = std::fs::create_dir_all(&temp_dir) {
                log::warn!("[FILE_WATCHER] create_dir_all: {}", e);
            }
            if let Err(e) = watcher.watch(&temp_dir, RecursiveMode::Recursive) {
                log::error!("[FILE_WATCHER] watch: {}", e);
            }

            loop {
                std::thread::sleep(check_interval);
                let now = Instant::now();
                let to_send: Vec<WatchedFile> = {
                    let mut map = watched.lock().unwrap();
                    let mut send = Vec::new();
                    for (_path, wf) in map.iter_mut() {
                        if now.duration_since(wf.last_modified) < debounce {
                            continue;
                        }
                        let should_send = wf
                            .last_sent
                            .map(|s| wf.last_modified > s)
                            .unwrap_or(true);
                        if !should_send {
                            continue;
                        }
                        let current_hash = hash_file(&wf.temp_path).unwrap_or_default();
                        if current_hash == wf.initial_hash {
                            continue;
                        }
                        wf.initial_hash = current_hash.clone();
                        wf.last_sent = Some(wf.last_modified);
                        send.push(wf.clone());
                    }
                    send
                };
                for wf in to_send {
                    if tx.blocking_send(wf).is_err() {
                        break;
                    }
                }
            }
        });
    }
}
