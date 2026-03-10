//! Server WebDAV: file in chiaro con nome originale in temp_dir.
//! Tracking tramite hash SHA-256 (xattr non copiati da WebDAV).
//! PUT: upload file dal Finder → cifratura e upload su backend AXSHARE.

use std::path::Path;
use std::sync::Arc;

use tauri::Emitter;
use tauri::Manager;
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Key, Nonce,
};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use dav_server::warp::dav_dir;
use percent_encoding::percent_decode_str;
use warp::{Filter, Reply};
use rsa::pkcs8::DecodePublicKey;
use rsa::Oaep;
use sha2::{Digest, Sha256};
use tokio::sync::RwLock;

pub struct AxshareWebDAV {
    pub files: Arc<RwLock<Vec<FileEntry>>>,
    pub jwt_token: Arc<RwLock<String>>,
    pub backend_url: String,
    pub temp_dir: std::path::PathBuf,
    pub local_db: Option<Arc<crate::local_db::LocalDb>>,
    pub app_handle: tokio::sync::RwLock<Option<tauri::AppHandle>>,
}

#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct FileEntry {
    pub file_id: String,
    pub name: String,
    pub size: u64,
    pub file_key_base64: String,
    /// Path della cartella padre (es. "/" o "/NomeCartella"). Usato per scrivere il file nella sottodirectory corretta.
    pub folder_path: String,
    /// Timestamp Unix (secondi) per mtime del file su disco; None = lascia invariato.
    pub updated_at: Option<i64>,
}

fn safe_filename(name: &str, file_id: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(file_id);
    base.replace('/', "_").replace('\\', "_")
}

fn percent_decode(s: &str) -> String {
    percent_decode_str(s).decode_utf8_lossy().to_string()
}

/// Filtra file di sistema e temporanei (non caricarli né mostrarli).
fn should_skip_file(filename: &str) -> bool {
    let name = filename.trim();
    if name.is_empty() {
        return true;
    }
    // File di sistema macOS
    if name.starts_with("._") {
        return true;
    }
    if name == ".DS_Store" {
        return true;
    }
    if name == "Icon" || name == ".VolumeIcon.icns" {
        return true;
    }
    if name.starts_with('.') {
        return true;
    }
    // File temporanei Microsoft Office
    if name.starts_with("~$") {
        return true;
    }
    if name.starts_with("~WRL") {
        return true;
    }
    if name.ends_with(".tmp") || name.ends_with(".TMP") {
        return true;
    }
    false
}

impl AxshareWebDAV {
    pub fn new(
        jwt_token: String,
        backend_url: String,
        local_db: Option<Arc<crate::local_db::LocalDb>>,
    ) -> Self {
        let temp_dir = std::env::temp_dir().join("axshare_webdav");
        std::fs::create_dir_all(&temp_dir).ok();

        Self {
            files: Arc::new(RwLock::new(Vec::new())),
            jwt_token: Arc::new(RwLock::new(jwt_token)),
            backend_url,
            temp_dir,
            local_db,
            app_handle: tokio::sync::RwLock::new(None),
        }
    }

    pub fn temp_dir_path(&self) -> &std::path::Path {
        &self.temp_dir
    }

    /// Scarica, decifra e salva in chiaro con nome originale. Usa staging + swap atomico.
    /// `folder_paths`: path di cartelle da creare (es. ["/", "/Cartella1"]). `entries`: file con folder_path.
    pub async fn update_files(
        &self,
        folder_paths: Vec<String>,
        entries: Vec<FileEntry>,
    ) {
        log::info!(
            "[WEBDAV] update_files ENTRATA: folder_paths={}, entries={}",
            folder_paths.len(),
            entries.len()
        );
        let entries: Vec<FileEntry> = entries
            .into_iter()
            .filter(|f| !should_skip_file(f.name.trim()))
            .collect();

        let staging_dir = self.temp_dir.with_extension("staging");
        if let Err(e) = std::fs::create_dir_all(&staging_dir) {
            log::error!("[WEBDAV] create_dir_all staging: {}", e);
            return;
        }
        if let Ok(rd) = std::fs::read_dir(&staging_dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() {
                    let _ = std::fs::remove_dir_all(&p);
                } else {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }

        for path in &folder_paths {
            let rel = path.trim_start_matches('/');
            if rel.is_empty() {
                continue;
            }
            let full = staging_dir.join(rel);
            if let Err(e) = std::fs::create_dir_all(&full) {
                log::warn!("[WEBDAV] create_dir_all {:?}: {}", full, e);
            } else {
                log::info!("[WEBDAV] create_dir_all OK -> {}", full.display());
            }
        }

        let token = self.jwt_token.read().await.clone();
        let client = reqwest::Client::new();

        struct Written {
            entry: FileEntry,
            safe: String,
            hash: String,
            folder_path: String,
        }
        let mut written: Vec<Written> = Vec::new();

        for f in &entries {
            let url = format!(
                "{}/api/v1/files/{}/download",
                self.backend_url, f.file_id
            );

            let Ok(resp) = client
                .get(&url)
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .await
            else {
                continue;
            };

            let Ok(bytes) = resp.bytes().await else { continue };
            let encrypted = if bytes.starts_with(b"AXSHARE_DRM_V1") && bytes.len() > 134 {
                &bytes[134..]
            } else {
                &bytes[..]
            };

            let Ok(key_bytes) = B64.decode(&f.file_key_base64) else { continue };
            let Ok(plain) = crate::crypto_fuse::decrypt_blob(encrypted, &key_bytes) else {
                continue;
            };

            let safe = f
                .name
                .trim()
                .replace('/', "_")
                .replace('\\', "_")
                .replace('\0', "_");
            let safe = if safe.is_empty() {
                safe_filename(&f.name, &f.file_id)
            } else {
                safe
            };
            if safe.is_empty() {
                continue;
            }

            let rel = f.folder_path.trim_start_matches('/');
            let dest_dir = if rel.is_empty() {
                staging_dir.clone()
            } else {
                staging_dir.join(rel)
            };
            if let Err(e) = std::fs::create_dir_all(&dest_dir) {
                log::warn!("[WEBDAV] create_dir_all {:?}: {}", dest_dir, e);
                eprintln!("[WEBDAV] create_dir_all FAIL dest_dir={:?}: {}", dest_dir, e);
                continue;
            }
            log::info!("[WEBDAV] dest_dir for file {} (folder_path={:?}) -> {}", safe, f.folder_path, dest_dir.display());
            let path = dest_dir.join(&safe);
            match std::fs::write(&path, &plain) {
                Ok(()) => {
                    log::info!("[DISK_WRITE] file: {} -> path: {}", safe, path.display());
                }
                Err(e) => {
                    log::error!("[WEBDAV] write FAIL {} -> {:?}: {}", safe, path, e);
                    eprintln!("[WEBDAV] write FAIL file={} path={:?}: {}", safe, path, e);
                    continue;
                }
            }

            if let Some(ts) = f.updated_at {
                let ft = filetime::FileTime::from_unix_time(ts, 0);
                if let Err(e) = filetime::set_file_mtime(&path, ft) {
                    log::warn!("[WEBDAV] set_file_mtime {}: {}", path.display(), e);
                }
            }

            let mut hasher = Sha256::new();
            hasher.update(&plain);
            let hash = format!("{:x}", hasher.finalize());
            written.push(Written {
                entry: f.clone(),
                safe: safe.clone(),
                hash,
                folder_path: f.folder_path.clone(),
            });
            log::info!("[WEBDAV] Staging: {}/{}", f.folder_path, safe);
        }

        let old_dir = self.temp_dir.with_extension("old");
        if old_dir.exists() {
            let _ = std::fs::remove_dir_all(&old_dir);
        }
        if self.temp_dir.exists() {
            let _ = std::fs::rename(&self.temp_dir, &old_dir);
        }
        if let Err(e) = std::fs::rename(&staging_dir, &self.temp_dir) {
            log::error!("[WEBDAV] swap staging->temp_dir: {}", e);
            if old_dir.exists() {
                let _ = std::fs::rename(&old_dir, &self.temp_dir);
            }
            return;
        }
        let _ = std::fs::remove_dir_all(&old_dir);

        {
            let mut files = self.files.write().await;
            *files = entries.clone();
        }

        for w in &written {
            let rel_dir = w.folder_path.trim_start_matches('/');
            let path = if rel_dir.is_empty() {
                self.temp_dir.join(&w.safe)
            } else {
                self.temp_dir.join(rel_dir).join(&w.safe)
            };
            #[cfg(unix)]
            let _ = crate::xattr_manager::set_axshare_xattr(
                &path,
                &w.entry.file_id,
                &w.entry.file_key_base64,
                &w.entry.name,
            );
            if let Some(ref db) = self.local_db {
                let local_path = path.to_string_lossy().to_string();
                let entry = crate::local_db::LocalFileEntry {
                    local_path,
                    file_id: w.entry.file_id.clone(),
                    file_key_base64: w.entry.file_key_base64.clone(),
                    original_name: w.entry.name.clone(),
                    content_hash: Some(w.hash.clone()),
                    status: "plain".to_string(),
                };
                if db.upsert(&entry).is_ok() {
                    log::info!("[WEBDAV] DB: {} hash={}...", w.safe, &w.hash[..8.min(w.hash.len())]);
                }
            }
        }

        log::info!("[WEBDAV] update_files: {} file (swap atomico)", entries.len());
    }

    pub async fn clear(&self) {
        if let Ok(dir) = std::fs::read_dir(&self.temp_dir) {
            for entry in dir.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        let mut files = self.files.write().await;
        files.clear();
        log::info!("[WEBDAV] clear: temp_dir e metadati cancellati");
    }

    /// Cifra e carica un file sul backend AXSHARE (formato API: metadata JSON + file).
    pub async fn encrypt_and_upload(
        &self,
        filename: &str,
        data: &[u8],
        token: &str,
    ) -> Result<String, String> {
        use rand::RngCore;

        let client = reqwest::Client::new();

        // 1. User id e chiave pubblica
        let me: serde_json::Value = client
            .get(format!("{}/api/v1/users/me", self.backend_url))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let user_id = me["id"].as_str().ok_or("No user id")?;

        let key_resp: serde_json::Value = client
            .get(format!(
                "{}/api/v1/users/{}/public-key",
                self.backend_url, user_id
            ))
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let public_key_pem = key_resp["public_key_pem"]
            .as_str()
            .ok_or("No public key")?;

        // 2. Chiave AES-256 e cifratura contenuto (formato [nonce][ciphertext])
        let mut file_key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut file_key);
        let encrypted_data = crate::crypto_fuse::encrypt_blob(data, &file_key)
            .map_err(|e| format!("encrypt_blob: {}", e))?;
        let encryption_iv_b64 = B64.encode(&encrypted_data[..12]);

        // 3. Cifra chiave file con RSA-OAEP-SHA256
        let pub_key = rsa::RsaPublicKey::from_public_key_pem(public_key_pem)
            .map_err(|e| format!("RSA PEM: {}", e))?;
        let padding = Oaep::new::<sha2::Sha256>();
        let encrypted_key = pub_key
            .encrypt(&mut rand::rngs::OsRng, padding, &file_key)
            .map_err(|e| format!("RSA encrypt: {}", e))?;
        let file_key_encrypted_b64 = B64.encode(&encrypted_key);

        // 4. Cifra nome e mime con AES-GCM, AAD = user_id (formato [nonce][ct])
        let encrypt_with_aad = |plain: &[u8], aad: &[u8]| -> Result<Vec<u8>, String> {
            let key = Key::<Aes256Gcm>::from_slice(&file_key);
            let cipher = Aes256Gcm::new(key);
            let mut nonce_bytes = [0u8; 12];
            rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
            let nonce = Nonce::from_slice(&nonce_bytes);
            let payload = Payload {
                msg: plain,
                aad,
            };
            let ct = cipher
                .encrypt(nonce, payload)
                .map_err(|e| format!("AES-GCM: {}", e))?;
            let mut out = nonce_bytes.to_vec();
            out.extend_from_slice(&ct);
            Ok(out)
        };
        let user_id_bytes = user_id.as_bytes();
        let name_encrypted_b64 =
            B64.encode(&encrypt_with_aad(filename.as_bytes(), user_id_bytes)?);
        let mime_encrypted_b64 = B64.encode(&encrypt_with_aad(
            b"application/octet-stream",
            user_id_bytes,
        )?);

        // 5. Content hash (SHA-256 hex)
        let mut hasher = Sha256::new();
        hasher.update(data);
        let content_hash = format!("{:x}", hasher.finalize());

        // 6. Metadata JSON (come da backend FileUploadMetadata)
        let metadata = serde_json::json!({
            "name_encrypted": name_encrypted_b64,
            "mime_type_encrypted": mime_encrypted_b64,
            "file_key_encrypted": file_key_encrypted_b64,
            "encryption_iv": encryption_iv_b64,
            "content_hash": content_hash,
            "size_original": data.len(),
        });

        // 7. Upload multipart
        let form = reqwest::multipart::Form::new()
            .text("metadata", metadata.to_string())
            .part(
                "file",
                reqwest::multipart::Part::bytes(encrypted_data.to_vec())
                    .file_name(filename.to_string())
                    .mime_str("application/octet-stream")
                    .map_err(|e| e.to_string())?,
            );

        let resp = client
            .post(format!("{}/api/v1/files/upload", self.backend_url))
            .header("Authorization", format!("Bearer {}", token))
            .multipart(form)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(format!("Upload failed: {}", err));
        }

        let result: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let file_id = result["file_id"].as_str().unwrap_or("").to_string();

        // 8. Aggiorna lista in memoria e DB locale
        let key_b64 = B64.encode(&file_key);
        {
            let mut files = self.files.write().await;
            files.push(FileEntry {
                file_id: file_id.clone(),
                name: filename.to_string(),
                size: data.len() as u64,
                file_key_base64: key_b64.clone(),
                folder_path: "/".to_string(),
                updated_at: None,
            });
        }

        if let Some(db) = &self.local_db {
            let mut hasher = Sha256::new();
            hasher.update(data);
            let hash = format!("{:x}", hasher.finalize());
            let local_path = self.temp_dir.join(filename);
            let _ = db.upsert(&crate::local_db::LocalFileEntry {
                local_path: local_path.to_string_lossy().to_string(),
                file_id: file_id.clone(),
                file_key_base64: key_b64,
                original_name: filename.to_string(),
                content_hash: Some(hash),
                status: "plain".to_string(),
            });
        }

        log::info!("[WEBDAV] File caricato: {} ({})", filename, file_id);

        // Notifica il frontend del nuovo file caricato
        if let Some(ref handle) = *self.app_handle.read().await {
            if let Some(window) = handle.get_webview_window("main") {
                let _ = window.emit("disk-file-uploaded", file_id.clone());
                log::info!("[WEBDAV] Emesso disk-file-uploaded per {}", file_id);
            }
        }

        Ok(file_id)
    }

    /// Elimina un file dal backend AXSHARE.
    pub async fn delete_file(&self, file_id: &str, token: &str) -> Result<(), String> {
        let client = reqwest::Client::new();
        let url = format!("{}/api/v1/files/{}/destroy", self.backend_url, file_id);

        let resp = client
            .delete(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !resp.status().is_success() {
            let err = resp.text().await.unwrap_or_default();
            return Err(format!("Delete failed: {}", err));
        }

        log::info!("[WEBDAV] File eliminato dal server: {}", file_id);
        Ok(())
    }
}

pub async fn start_webdav_server(
    webdav: Arc<AxshareWebDAV>,
    port: u16,
) -> Result<(), String> {
    let temp_dir = webdav.temp_dir_path().to_path_buf();

    // DELETE: file eliminato dal disco (cestino Finder) → elimina su backend e aggiorna stato
    let webdav_delete = {
        let wdav = webdav.clone();
        warp::delete()
            .and(warp::path::tail())
            .and_then(move |tail: warp::path::Tail| {
                let wdav = wdav.clone();
                async move {
                    let filename = percent_decode(tail.as_str());
                    if should_skip_file(&filename) {
                        return Ok::<_, warp::Rejection>(
                            warp::reply::with_status(
                                warp::reply(),
                                warp::http::StatusCode::NO_CONTENT,
                            )
                            .into_response(),
                        );
                    }
                    let filename = filename.trim();
                    log::info!("[WEBDAV] DELETE: {}", filename);

                    let file_id = {
                        let files = wdav.files.read().await;
                        files
                            .iter()
                            .find(|f| f.name.trim() == filename)
                            .map(|f| f.file_id.clone())
                    };

                    let Some(file_id) = file_id else {
                        return Ok::<_, warp::Rejection>(
                            warp::reply::with_status(
                                warp::reply(),
                                warp::http::StatusCode::NOT_FOUND,
                            )
                            .into_response(),
                        );
                    };

                    let token = wdav.jwt_token.read().await.clone();
                    match wdav.delete_file(&file_id, &token).await {
                        Ok(_) => {
                            let mut files = wdav.files.write().await;
                            files.retain(|f| f.file_id != file_id);
                            drop(files);

                            let path = wdav.temp_dir.join(filename);
                            std::fs::remove_file(&path).ok();

                            if let Some(db) = &wdav.local_db {
                                let path_str = path.to_string_lossy().to_string();
                                let _ = db.remove(&path_str);
                            }

                            log::info!("[WEBDAV] DELETE OK: {}", filename);
                            Ok::<_, warp::Rejection>(
                                warp::reply::with_status(
                                    warp::reply(),
                                    warp::http::StatusCode::NO_CONTENT,
                                )
                                .into_response(),
                            )
                        }
                        Err(e) => {
                            log::error!("[WEBDAV] DELETE error: {}", e);
                            Ok::<_, warp::Rejection>(
                                warp::reply::with_status(
                                    warp::reply(),
                                    warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                                )
                                .into_response(),
                            )
                        }
                    }
                }
            })
    };

    // MOVE verso Cestino (macOS) → tratta come DELETE
    let webdav_move = {
        let wdav = webdav.clone();
        warp::method()
            .and(warp::path::tail())
            .and(warp::header::optional::<String>("destination"))
            .and_then(move |method: warp::http::Method, tail: warp::path::Tail, dest: Option<String>| {
                let wdav = wdav.clone();
                async move {
                    if method.as_str() != "MOVE" {
                        return Err(warp::reject::not_found());
                    }
                    let destination = dest.unwrap_or_default();
                    if !destination.to_lowercase().contains("trash") {
                        return Err(warp::reject::not_found());
                    }

                    let filename = percent_decode(tail.as_str()).trim().to_string();
                    if should_skip_file(&filename) {
                        return Ok::<_, warp::Rejection>(
                            warp::reply::with_status(
                                warp::reply(),
                                warp::http::StatusCode::NO_CONTENT,
                            )
                            .into_response(),
                        );
                    }
                    log::info!("[WEBDAV] MOVE to Trash = DELETE: {}", filename);

                    let file_id = {
                        let files = wdav.files.read().await;
                        let id = files
                            .iter()
                            .find(|f| f.name.trim() == filename)
                            .map(|f| f.file_id.clone());
                        drop(files);
                        id
                    };

                    if let Some(fid) = file_id {
                        let token = wdav.jwt_token.read().await.clone();
                        let _ = wdav.delete_file(&fid, &token).await;

                        let mut files = wdav.files.write().await;
                        files.retain(|f| f.file_id != fid);
                        drop(files);

                        let path = wdav.temp_dir.join(&filename);
                        std::fs::remove_file(&path).ok();

                        if let Some(db) = &wdav.local_db {
                            let path_str = path.to_string_lossy().to_string();
                            let _ = db.remove(&path_str);
                        }
                    }

                    Ok::<_, warp::Rejection>(
                        warp::reply::with_status(
                            warp::reply(),
                            warp::http::StatusCode::NO_CONTENT,
                        )
                        .into_response(),
                    )
                }
            })
    };

    // PUT: upload file dal Finder → salva in temp_dir e cifra/upload su backend
    let webdav_put = {
        let wdav = webdav.clone();
        warp::put()
            .and(warp::path::tail())
            .and(warp::body::bytes())
            .and_then(move |tail: warp::path::Tail, body: bytes::Bytes| {
                let wdav = wdav.clone();
                async move {
                    let filename = percent_decode(tail.as_str());
                    if should_skip_file(&filename) {
                        return Ok::<_, warp::Rejection>(
                            warp::reply::with_status(
                                warp::reply(),
                                warp::http::StatusCode::CREATED,
                            )
                            .into_response(),
                        );
                    }
                    if body.len() < 10 {
                        return Ok::<_, warp::Rejection>(
                            warp::reply::with_status(
                                warp::reply(),
                                warp::http::StatusCode::CREATED,
                            )
                            .into_response(),
                        );
                    }
                    let filename = filename.trim();
                    let safe_name = filename
                        .replace('/', "_")
                        .replace('\\', "_")
                        .replace('\0', "_");
                    if safe_name.is_empty() {
                        return Ok(warp::reply::with_status(
                            "Bad Request",
                            warp::http::StatusCode::BAD_REQUEST,
                        )
                        .into_response());
                    }
                    log::info!("[WEBDAV] PUT: {} ({} bytes)", safe_name, body.len());

                    if std::fs::write(wdav.temp_dir.join(&safe_name), &body).is_err() {
                        return Ok(warp::reply::with_status(
                            "Internal Server Error",
                            warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                        )
                        .into_response());
                    }

                    let token = wdav.jwt_token.read().await.clone();
                    match wdav
                        .encrypt_and_upload(&safe_name, &body, &token)
                        .await
                    {
                        Ok(file_id) => {
                            log::info!("[WEBDAV] Upload OK: {} -> {}", safe_name, file_id);
                            Ok(warp::reply::with_status(
                                warp::reply(),
                                warp::http::StatusCode::CREATED,
                            )
                            .into_response())
                        }
                        Err(e) => {
                            log::error!("[WEBDAV] Upload error: {}", e);
                            Ok(warp::reply::with_status(
                                warp::reply(),
                                warp::http::StatusCode::INTERNAL_SERVER_ERROR,
                            )
                            .into_response())
                        }
                    }
                }
            })
    };

    let dav_filter = dav_dir(temp_dir.clone(), false, true);
    let routes = webdav_move
        .or(webdav_delete)
        .or(webdav_put)
        .or(dav_filter);

    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    log::info!(
        "[WEBDAV] Serving (GET/PUT) on http://127.0.0.1:{}/",
        port
    );
    warp::serve(routes).run(addr).await;
    Ok(())
}
