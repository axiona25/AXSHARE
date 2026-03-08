//! Disco virtuale AXSHARE: WebDAV su localhost (macOS).
//! Windows: stub non implementato.

use std::sync::Arc;
use tokio::sync::RwLock;

const API_PREFIX: &str = "/api/v1";

#[cfg(target_os = "macos")]
use crate::virtual_disk::webdav_server::{start_webdav_server, AxshareWebDAV, FileEntry};

const WEBDAV_PORT: u16 = 8888;
const MOUNT_POINT: &str = "/Volumes/AXSHARE";
const BACKEND_URL: &str = "http://localhost:8000";

#[cfg(target_os = "macos")]
async fn start_health_check(mounted: Arc<tokio::sync::RwLock<bool>>, port: u16) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;

        if !*mounted.read().await {
            continue;
        }

        let ok = reqwest::get(format!("http://127.0.0.1:{}/", port))
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);

        if !ok {
            log::info!("[HEALTH] Server WebDAV non risponde, smonto disco...");

            for name in &["axshare-disk", "AXSHARE", "127.0.0.1"] {
                let script = format!(
                    r#"tell application "Finder"
    try
        eject disk "{}"
    end try
end tell"#,
                    name
                );
                let _ = std::process::Command::new("osascript")
                    .args(["-e", &script])
                    .output();
            }

            *mounted.write().await = false;
            log::info!("[HEALTH] Disco smontato");
        }
    }
}

/// Voce file esposta nel disco virtuale (nomi decifrati dal frontend).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DiskFileEntry {
    pub file_id: String,
    pub name: String,
    pub size: u64,
    pub is_folder: bool,
    pub folder_path: String,
    #[serde(default)]
    #[serde(alias = "fileKeyBase64")]
    pub file_key_base64: Option<String>,
}

#[cfg(target_os = "macos")]
pub mod webdav_server;

/// Estrae file_key_base64 dal JSON di un file (se presente; il backend list non lo restituisce).
fn get_file_key(f: &serde_json::Value) -> Option<String> {
    f.get("file_key_base64")
        .and_then(|v| v.as_str())
        .map(String::from)
}

/// Nome sicuro per cartella (nomi cifrati dal backend).
fn safe_folder_name(id: &str, name_encrypted: Option<&str>) -> String {
    let name = name_encrypted
        .unwrap_or("")
        .chars()
        .take(40)
        .collect::<String>()
        .replace('/', "_")
        .replace('\\', "_");
    if name.is_empty() {
        format!("folder_{}", id.chars().take(8).collect::<String>())
    } else {
        name
    }
}

/// Recupera l'albero cartelle/file dal backend (GET /folders, /folders/{id}/children, /folders/{id}/files).
/// I file hanno file_key_base64=None (il backend non restituisce la chiave; il frontend può inviarla con update_disk_file_list).
#[cfg(target_os = "macos")]
async fn fetch_folder_tree(
    backend_url: &str,
    token: &str,
) -> Result<Vec<DiskFileEntry>, String> {
    let api_base = format!("{}{}/folders", backend_url.trim_end_matches('/'), API_PREFIX);
    let client = reqwest::Client::new();
    let auth = format!("Bearer {}", token);

    let mut out: Vec<DiskFileEntry> = Vec::new();

    // File in root (prima delle cartelle)
    let root_files_url = format!(
        "{}{}/folders/root/files",
        backend_url.trim_end_matches('/'),
        API_PREFIX
    );
    let root_resp = client
        .get(&root_files_url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if root_resp.status().is_success() {
        if let Ok(files) = root_resp.json::<Vec<serde_json::Value>>().await {
            for f in files {
                let file_id = f["id"].as_str().unwrap_or("").to_string();
                let name = f["name_encrypted"]
                    .as_str()
                    .unwrap_or("unknown")
                    .chars()
                    .take(80)
                    .collect::<String>()
                    .replace('/', "_")
                    .replace('\\', "_");
                let size = f["size"].as_u64().unwrap_or(0);
                let key = get_file_key(&f);
                if !file_id.is_empty() {
                    out.push(DiskFileEntry {
                        file_id,
                        name,
                        size,
                        is_folder: false,
                        folder_path: "/".to_string(),
                        file_key_base64: key,
                    });
                }
            }
        }
    }

    // Root: GET /api/v1/folders (list root folders)
    let root_url = format!("{}", api_base);
    let resp = client
        .get(&root_url)
        .header("Authorization", &auth)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("root folders failed: {}", resp.status()));
    }
    let root_folders: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;

    #[derive(Clone)]
    struct FolderJob {
        id: String,
        parent_path: String,
    }
    let mut queue: Vec<FolderJob> = Vec::new();
    for r in &root_folders {
        let id = r["id"].as_str().ok_or("missing root folder id")?.to_string();
        let name_enc = r["name_encrypted"].as_str();
        let name = safe_folder_name(&id, name_enc);
        out.push(DiskFileEntry {
            file_id: id.clone(),
            name: name.clone(),
            size: 0,
            is_folder: true,
            folder_path: "/".to_string(),
            file_key_base64: None,
        });
        let parent_path = format!("/{}", name);
        queue.push(FolderJob {
            id,
            parent_path,
        });
    }

    while let Some(job) = queue.pop() {
        let folder_base = format!("{}/{}", api_base.trim_end_matches('/'), job.id);

        let url = format!("{}/children", folder_base);
        let resp = client
            .get(&url)
            .header("Authorization", &auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !resp.status().is_success() {
            return Err(format!("children failed: {}", resp.status()));
        }
        let children: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;

        for c in &children {
            let id = c["id"].as_str().ok_or("missing id")?.to_string();
            let name_enc = c["name_encrypted"].as_str();
            let name = safe_folder_name(&id, name_enc);
            let folder_path = if job.parent_path.is_empty() {
                format!("/{}", name)
            } else {
                format!("{}/{}", job.parent_path, name)
            };
            out.push(DiskFileEntry {
                file_id: id.clone(),
                name: name.clone(),
                size: 0,
                is_folder: true,
                folder_path: folder_path.clone(),
                file_key_base64: None,
            });
            queue.push(FolderJob { id, parent_path: folder_path });
        }

        let files_url = format!("{}/files", folder_base);
        let files_resp = client
            .get(&files_url)
            .header("Authorization", &auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if files_resp.status().is_success() {
            if let Ok(files) = files_resp.json::<Vec<serde_json::Value>>().await {
                for f in files {
                    let id = f["id"].as_str().ok_or("missing file id")?.to_string();
                    let name_enc = f["name_encrypted"].as_str().unwrap_or("");
                    let name = if name_enc.is_empty() {
                        format!("file_{}", id.chars().take(8).collect::<String>())
                    } else {
                        name_enc
                            .chars()
                            .take(80)
                            .collect::<String>()
                            .replace('/', "_")
                            .replace('\\', "_")
                    };
                    let size = f["size"].as_u64().unwrap_or(0);
                    let folder_path = if job.parent_path.is_empty() {
                        "/".to_string()
                    } else {
                        job.parent_path.clone()
                    };
                    out.push(DiskFileEntry {
                        file_id: id,
                        name,
                        size,
                        is_folder: false,
                        folder_path,
                        file_key_base64: None,
                    });
                }
            }
        }
    }

    Ok(out)
}

pub struct VirtualDisk {
    #[cfg(target_os = "macos")]
    webdav: Arc<AxshareWebDAV>,
    #[cfg(target_os = "macos")]
    last_disk_files: Arc<RwLock<Vec<DiskFileEntry>>>,
    mounted: Arc<RwLock<bool>>,
}

impl VirtualDisk {
    pub fn new(local_db: Arc<crate::local_db::LocalDb>) -> Self {
        Self {
            #[cfg(target_os = "macos")]
            webdav: Arc::new(AxshareWebDAV::new(
                String::new(),
                BACKEND_URL.to_string(),
                Some(local_db),
            )),
            #[cfg(target_os = "macos")]
            last_disk_files: Arc::new(RwLock::new(Vec::new())),
            mounted: Arc::new(RwLock::new(false)),
        }
    }

    #[cfg(target_os = "macos")]
    pub async fn mount(&self, jwt_token: String) -> Result<String, String> {
        if *self.mounted.read().await {
            return Err("Disco già montato".to_string());
        }

        *self.webdav.jwt_token.write().await = jwt_token.clone();

        let webdav = self.webdav.clone();
        tokio::spawn(async move {
            if let Err(e) = start_webdav_server(webdav, WEBDAV_PORT).await {
                log::error!("[WEBDAV] Server error: {}", e);
            }
        });

        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        // Aspetta che il server WebDAV risponda
        let webdav_url = format!("http://127.0.0.1:{}/", WEBDAV_PORT);
        let mut ready = false;
        for _ in 0..10 {
            if reqwest::get(&webdav_url).await.is_ok() {
                ready = true;
                break;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        }
        if !ready {
            return Err("WebDAV server non risponde".to_string());
        }

        // Aggiungi hostname custom a /etc/hosts (se non presente) così il volume si chiama "axshare-disk"
        let hosts_entry = "127.0.0.1 axshare-disk";
        let hosts = std::fs::read_to_string("/etc/hosts").unwrap_or_default();
        if !hosts.contains("axshare-disk") {
            let script = format!(
                "do shell script \"echo '{}' >> /etc/hosts\" with administrator privileges",
                hosts_entry
            );
            let _ = std::process::Command::new("osascript")
                .args(["-e", &script])
                .output();
        }

        // Smonta eventuale mount precedente
        for name in &["AXSHARE", "axshare-disk", "127.0.0.1"] {
            let path = format!("/Volumes/{}", name);
            let _ = std::process::Command::new("diskutil")
                .args(["unmount", "force", &path])
                .output();
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

        let mount_url = "http://axshare-disk:8888/";
        let mount_point = "/Volumes/axshare-disk";
        std::fs::create_dir_all(mount_point).ok();

        // Monta con mount_webdav -S (suppress connection alerts) per evitare modale "Connessione server interrotta"
        let output = std::process::Command::new("mount_webdav")
            .args(["-S", "-v", "axshare-disk", mount_url, mount_point])
            .output()
            .map_err(|e| e.to_string())?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::info!("[WEBDAV] mount_webdav fallback a Finder: {}", stderr);
            let mount_script = format!(
                r#"tell application "Finder"
        try
            mount volume "{}"
        end try
    end tell"#,
                mount_url
            );
            let output2 = std::process::Command::new("osascript")
                .args(["-e", &mount_script])
                .output()
                .map_err(|e| e.to_string())?;
            if !output2.status.success() {
                let err = String::from_utf8_lossy(&output2.stderr);
                return Err(format!("Mount fallito: {}", err));
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;

        *self.mounted.write().await = true;

        // Imposta icona personalizzata sul volume montato
        let icons_dir = std::env::var("AXSHARE_ICONS_DIR").unwrap_or_default();
        if !icons_dir.is_empty() {
            let png_path = format!("{}/Hard_Disk_active.png", icons_dir);
            if std::path::Path::new(&png_path).exists() {
                // Crea iconset temporaneo
                let iconset = "/tmp/axshare_vol.iconset";
                let _ = std::fs::create_dir_all(iconset);
                let _ = std::fs::copy(&png_path, format!("{}/icon_512x512.png", iconset));
                let _ = std::fs::copy(&png_path, format!("{}/icon_256x256.png", iconset));
                let _ = std::fs::copy(&png_path, format!("{}/icon_128x128.png", iconset));
                let icns_path = "/tmp/axshare_vol.icns";
                let _ = std::process::Command::new("iconutil")
                    .args(["-c", "icns", iconset, "-o", icns_path])
                    .output();
                if std::path::Path::new(icns_path).exists() {
                    // Scrivi .VolumeIcon.icns nella root del volume
                    let dest = format!("{}/.VolumeIcon.icns", mount_point);
                    let _ = std::fs::copy(icns_path, &dest);
                    // Attiva flag icona custom sul volume
                    let _ = std::process::Command::new("SetFile")
                        .args(["-a", "C", mount_point])
                        .output();
                    // Nasconde il file icona
                    let _ = std::process::Command::new("SetFile")
                        .args(["-a", "V", &dest])
                        .output();
                    // Refresh Finder
                    let _ = std::process::Command::new("osascript")
                        .args(["-e", "tell application \"Finder\" to update item (POSIX file \"/Volumes/axshare-disk\") as alias"])
                        .output();
                    log::info!("[WEBDAV] Icona volume impostata via iconutil");
                }
            }
        }

        let mounted_clone = self.mounted.clone();
        tokio::spawn(async move {
            start_health_check(mounted_clone, WEBDAV_PORT).await;
        });

        log::info!("[WEBDAV] Montato come axshare-disk");
        Ok(mount_url.to_string())
    }

    #[cfg(not(target_os = "macos"))]
    pub async fn mount(&self, _jwt_token: String) -> Result<String, String> {
        Err("Disco virtuale non disponibile su questo sistema operativo".to_string())
    }

    pub async fn unmount(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            self.webdav.clear().await;

            for path in &[
                "/Volumes/axshare-disk",
                "/Volumes/AXSHARE",
                "/Volumes/127.0.0.1",
            ] {
                let _ = std::process::Command::new("umount")
                    .args(["-f", path])
                    .output();
                let _ = std::process::Command::new("diskutil")
                    .args(["unmount", "force", path])
                    .output();
            }

            for path in &["/Volumes/axshare-disk", "/Volumes/AXSHARE"] {
                let _ = std::fs::remove_dir(path);
            }

            log::info!("[WEBDAV] Smontato e memoria pulita");
        }
        *self.mounted.write().await = false;
        Ok(())
    }

    pub async fn update_files(&self, files: Vec<DiskFileEntry>) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            *self.last_disk_files.write().await = files.clone();
            let mut folder_paths: Vec<String> = Vec::new();
            for entry in &files {
                if entry.is_folder {
                    let full = if entry.folder_path == "/" || entry.folder_path.is_empty() {
                        entry.name.clone()
                    } else {
                        format!(
                            "{}/{}",
                            entry.folder_path.trim_start_matches('/'),
                            entry.name
                        )
                    };
                    if !full.is_empty() && !folder_paths.contains(&full) {
                        folder_paths.push(full);
                    }
                }
            }
            let n = files.len();
            let mut entries = Vec::with_capacity(n);
            for f in files {
                let has_key = f.file_key_base64.is_some();
                println!(
                    "[VIRTUAL_DISK] update_files entry: {} ({}) file_key_base64={}",
                    f.name,
                    f.file_id,
                    if has_key { "Some" } else { "None" }
                );
                if let Some(k) = f.file_key_base64 {
                    entries.push(FileEntry {
                        file_id: f.file_id,
                        name: f.name,
                        size: f.size,
                        file_key_base64: k,
                        folder_path: f.folder_path.clone(),
                    });
                }
            }
            println!(
                "[VIRTUAL_DISK] update_files: {} DiskFileEntry -> {} FileEntry (con chiave), {} cartelle",
                n,
                entries.len(),
                folder_paths.len()
            );
            println!(
                "[VIRTUAL_DISK] Chiamata webdav.update_files(folder_paths.len()={}, entries.len()={})",
                folder_paths.len(),
                entries.len()
            );
            self.webdav.update_files(folder_paths, entries).await;
        }
        #[cfg(not(target_os = "macos"))]
        let _ = files;
        Ok(())
    }

    pub async fn is_mounted(&self) -> bool {
        *self.mounted.read().await
    }

    #[cfg(target_os = "macos")]
    /// Imposta il JWT prima di update_files così fetch_and_decrypt può scaricare i file.
    pub async fn set_jwt_token(&self, token: String) {
        let mut t = self.webdav.jwt_token.write().await;
        *t = token;
    }

    #[cfg(not(target_os = "macos"))]
    pub async fn set_jwt_token(&self, _token: String) {}

    #[cfg(target_os = "macos")]
    pub async fn apply_volume_icon(&self) {
        let icons_dir = std::env::var("AXSHARE_ICONS_DIR").unwrap_or_default();
        if icons_dir.is_empty() {
            return;
        }
        let mount_point = "/Volumes/axshare-disk";
        let icns_path = "/tmp/axshare_vol.icns";
        if std::path::Path::new(icns_path).exists() {
            let dest = format!("{}/.VolumeIcon.icns", mount_point);
            let _ = std::fs::copy(icns_path, &dest);
            let _ = std::process::Command::new("SetFile")
                .args(["-a", "C", mount_point])
                .output();
            let _ = std::process::Command::new("osascript")
                .args(["-e", "tell application \"Finder\" to update item (POSIX file \"/Volumes/axshare-disk\") as alias"])
                .output();
            log::info!("[WEBDAV] apply_volume_icon OK");
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub async fn apply_volume_icon(&self) {}
}

#[cfg(target_os = "windows")]
mod windows;
