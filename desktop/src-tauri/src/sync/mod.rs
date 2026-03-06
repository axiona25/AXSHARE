//! Motore di sincronizzazione offline e cache locale cifrata.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::api_client::ApiClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileManifest {
    pub file_id: String,
    pub filename_encrypted: String,
    pub version: u32,
    pub size_bytes: u64,
    pub last_sync: u64,
    pub local_modified: Option<u64>,
    pub etag: Option<String>,
    pub offline_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncManifest {
    pub version: u32,
    pub last_full_sync: u64,
    pub files: HashMap<String, FileManifest>,
}

#[derive(Debug, Clone)]
pub enum SyncStatus {
    Idle,
    Syncing {
        current: String,
        total: u32,
        done: u32,
    },
    Error(String),
    Paused,
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncProgress {
    pub status: String,
    pub current_file: Option<String>,
    pub total: u32,
    pub done: u32,
    pub last_sync: u64,
}

pub struct SyncEngine {
    api: Arc<ApiClient>,
    cache_dir: PathBuf,
    manifest: Arc<RwLock<SyncManifest>>,
    status: Arc<RwLock<SyncStatus>>,
    paused: Arc<RwLock<bool>>,
    /// Ultimo timestamp (RFC3339) usato per polling eventi sync (share_revoked, guest_revoked)
    last_event_check: Arc<RwLock<String>>,
}

impl SyncEngine {
    pub fn new(api: ApiClient) -> Self {
        let cache_dir = get_cache_dir();
        let manifest = load_or_create_manifest(&cache_dir);
        Self {
            api: Arc::new(api),
            cache_dir,
            manifest: Arc::new(RwLock::new(manifest)),
            status: Arc::new(RwLock::new(SyncStatus::Idle)),
            paused: Arc::new(RwLock::new(false)),
            last_event_check: Arc::new(RwLock::new(
                "1970-01-01T00:00:00Z".to_string(),
            )),
        }
    }

    /// Imposta il token JWT per le chiamate API (da chiamare dopo login).
    pub async fn set_token(&self, token: String) {
        self.api.set_token(token).await;
    }

    /// Avvia sync completa in background
    pub async fn start_sync(&self) -> Result<SyncProgress, String> {
        if *self.paused.read().await {
            return Err("Sync in pausa".to_string());
        }

        let api = self.api.clone();
        let cache_dir = self.cache_dir.clone();
        let manifest = self.manifest.clone();
        let status = self.status.clone();

        tokio::spawn(async move {
            *status.write().await = SyncStatus::Syncing {
                current: "Recupero lista file...".to_string(),
                total: 0,
                done: 0,
            };

            match sync_all_files(api, cache_dir, manifest.clone()).await {
                Ok(count) => {
                    log::info!("Sync completata: {} file", count);
                    *status.write().await = SyncStatus::Idle;
                }
                Err(e) => {
                    log::error!("Sync fallita: {}", e);
                    *status.write().await = SyncStatus::Error(e);
                }
            }
        });

        Ok(self.get_progress().await)
    }

    pub async fn pause(&self) {
        *self.paused.write().await = true;
        *self.status.write().await = SyncStatus::Paused;
    }

    /// Ferma il sync (per graceful shutdown).
    pub async fn stop(&self) {
        self.pause().await;
    }

    pub async fn resume(&self) {
        *self.paused.write().await = false;
        let _ = self.start_sync().await;
    }

    pub async fn get_progress(&self) -> SyncProgress {
        let status = self.status.read().await.clone();
        let manifest = self.manifest.read().await;
        let last_sync = manifest.last_full_sync;
        match status {
            SyncStatus::Idle => SyncProgress {
                status: "idle".into(),
                current_file: None,
                total: 0,
                done: 0,
                last_sync,
            },
            SyncStatus::Syncing {
                current,
                total,
                done,
            } => SyncProgress {
                status: "syncing".into(),
                current_file: Some(current),
                total,
                done,
                last_sync,
            },
            SyncStatus::Error(e) => SyncProgress {
                status: format!("error: {}", e),
                current_file: None,
                total: 0,
                done: 0,
                last_sync,
            },
            SyncStatus::Paused => SyncProgress {
                status: "paused".into(),
                current_file: None,
                total: 0,
                done: 0,
                last_sync,
            },
        }
    }

    /// Marca un file per uso offline
    pub async fn enable_offline(&self, file_id: &str) -> Result<(), String> {
        let mut manifest = self.manifest.write().await;
        if let Some(entry) = manifest.files.get_mut(file_id) {
            entry.offline_enabled = true;
        } else {
            manifest.files.insert(
                file_id.to_string(),
                FileManifest {
                    file_id: file_id.to_string(),
                    filename_encrypted: String::new(),
                    version: 1,
                    size_bytes: 0,
                    last_sync: 0,
                    local_modified: None,
                    etag: None,
                    offline_enabled: true,
                },
            );
        }
        save_manifest(&self.cache_dir, &manifest)?;
        Ok(())
    }

    /// Rimuove un file dalla cache offline
    pub async fn disable_offline(&self, file_id: &str) -> Result<(), String> {
        let mut manifest = self.manifest.write().await;
        if let Some(entry) = manifest.files.get_mut(file_id) {
            entry.offline_enabled = false;
            let cache_path = self.cache_dir.join(format!("{}.enc", file_id));
            if cache_path.exists() {
                std::fs::remove_file(&cache_path).ok();
            }
            save_manifest(&self.cache_dir, &manifest)?;
        }
        Ok(())
    }

    /// Ottieni file dalla cache (se offline-enabled e cached)
    pub async fn get_cached_file(&self, file_id: &str) -> Option<Vec<u8>> {
        let cache_path = self.cache_dir.join(format!("{}.enc", file_id));
        tokio::fs::read(&cache_path).await.ok()
    }

    /// Salva file nella cache (cifrato)
    pub async fn cache_file(&self, file_id: &str, encrypted_data: &[u8]) -> Result<(), String> {
        std::fs::create_dir_all(&self.cache_dir).ok();
        let cache_path = self.cache_dir.join(format!("{}.enc", file_id));
        tokio::fs::write(&cache_path, encrypted_data)
            .await
            .map_err(|e| e.to_string())
    }

    /// Lista file offline disponibili
    pub async fn list_offline_files(&self) -> Vec<FileManifest> {
        let manifest = self.manifest.read().await;
        manifest
            .files
            .values()
            .filter(|f| f.offline_enabled)
            .cloned()
            .collect()
    }

    /// Ottieni dimensione totale cache
    pub async fn get_cache_size_bytes(&self) -> u64 {
        let manifest = self.manifest.read().await;
        manifest
            .files
            .values()
            .filter(|f| f.offline_enabled)
            .map(|f| f.size_bytes)
            .sum()
    }

    /// Cancella tutta la cache locale
    pub async fn clear_cache(&self) -> Result<(), String> {
        let mut manifest = self.manifest.write().await;
        for entry in manifest.files.values_mut() {
            entry.offline_enabled = false;
            let cache_path = self.cache_dir.join(format!("{}.enc", entry.file_id));
            std::fs::remove_file(&cache_path).ok();
        }
        save_manifest(&self.cache_dir, &manifest)
    }

    /// Rimuove un file dalla cache locale (chiamato quando arriva evento share_revoked/guest_revoked)
    pub async fn remove_cached_file(&self, file_id: &str) {
        let mut manifest = self.manifest.write().await;
        if let Some(entry) = manifest.files.get_mut(file_id) {
            entry.offline_enabled = false;
        }
        drop(manifest);
        let cache_path = self.cache_dir.join(format!("{}.enc", file_id));
        if cache_path.exists() {
            let _ = std::fs::remove_file(&cache_path);
        }
        let manifest = self.manifest.read().await;
        if let Err(e) = save_manifest(&self.cache_dir, &manifest) {
            log::warn!("save_manifest after remove_cached_file: {}", e);
        }
    }

    /// Polling eventi sync: se share_revoked o guest_revoked, rimuove il file dalla cache locale
    pub async fn check_sync_events(&self) {
        let since = self.last_event_check.read().await.clone();
        let events = match self.api.get_sync_events(&since).await {
            Ok(ev) => ev,
            Err(e) => {
                log::warn!("get_sync_events failed: {}", e);
                return;
            }
        };
        for event in &events {
            if event.event_type == "share_revoked" || event.event_type == "guest_revoked" {
                if let Some(ref file_id) = event.file_id {
                    self.remove_cached_file(file_id).await;
                    log::info!("File {} rimosso per revoca condivisione", file_id);
                }
            }
        }
        *self.last_event_check.write().await = Utc::now().to_rfc3339();
    }
}

async fn sync_all_files(
    api: Arc<ApiClient>,
    cache_dir: PathBuf,
    manifest: Arc<RwLock<SyncManifest>>,
) -> Result<u32, String> {
    let folders = api.list_folders().await?;
    let mut synced = 0u32;

    for folder in &folders {
        let files = api.list_files(&folder.id).await.unwrap_or_default();

        for file in &files {
            if file.is_destroyed {
                continue;
            }

            let cache_path = cache_dir.join(format!("{}.enc", file.id));
            let cache_exists = cache_path.exists();

            let mut m = manifest.write().await;
            let needs_download = match m.files.get(&file.id) {
                None => true,
                Some(entry) => {
                    entry.offline_enabled
                        && (!cache_exists || entry.size_bytes != file.size_bytes)
                }
            };

            m.files
                .entry(file.id.clone())
                .or_insert_with(|| FileManifest {
                    file_id: file.id.clone(),
                    filename_encrypted: file.name_encrypted.clone(),
                    version: 1,
                    size_bytes: file.size_bytes,
                    last_sync: unix_now(),
                    local_modified: None,
                    etag: None,
                    offline_enabled: false,
                });
            drop(m);

            let m = manifest.read().await;
            let offline = m
                .files
                .get(&file.id)
                .map(|e| e.offline_enabled)
                .unwrap_or(false);
            drop(m);

            if offline && needs_download {
                match api.download_encrypted(&file.id).await {
                    Ok(data) => {
                        std::fs::create_dir_all(&cache_dir).ok();
                        if tokio::fs::write(&cache_path, &data).await.is_ok() {
                            synced += 1;
                            let mut m = manifest.write().await;
                            if let Some(entry) = m.files.get_mut(&file.id) {
                                entry.size_bytes = file.size_bytes;
                                entry.last_sync = unix_now();
                            }
                            drop(m);
                        }
                    }
                    Err(e) => log::warn!("Download fallito per {}: {}", file.id, e),
                }
            }
        }
    }

    let mut m = manifest.write().await;
    m.last_full_sync = unix_now();
    save_manifest(&cache_dir, &m)?;

    Ok(synced)
}

fn get_cache_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(format!("{}/Library/Application Support/AXSHARE/cache", home))
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(format!("{}\\AXSHARE\\cache", appdata))
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        PathBuf::from("/tmp/axshare-cache")
    }
}

fn load_or_create_manifest(cache_dir: &PathBuf) -> SyncManifest {
    let path = cache_dir.join("manifest.json");
    if let Ok(data) = std::fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_else(|_| default_manifest())
    } else {
        default_manifest()
    }
}

fn save_manifest(cache_dir: &PathBuf, manifest: &SyncManifest) -> Result<(), String> {
    std::fs::create_dir_all(cache_dir).ok();
    let path = cache_dir.join("manifest.json");
    let json = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

fn default_manifest() -> SyncManifest {
    SyncManifest {
        version: 1,
        last_full_sync: 0,
        files: HashMap::new(),
    }
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
