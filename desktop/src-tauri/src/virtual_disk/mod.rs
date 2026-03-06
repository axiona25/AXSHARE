//! Disco virtuale AXSHARE: WebDAV su localhost (macOS).
//! Windows: stub non implementato.

use std::sync::Arc;
use tokio::sync::RwLock;

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

pub struct VirtualDisk {
    #[cfg(target_os = "macos")]
    webdav: Arc<AxshareWebDAV>,
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
            mounted: Arc::new(RwLock::new(false)),
        }
    }

    #[cfg(target_os = "macos")]
    pub async fn mount(&self, jwt_token: String) -> Result<String, String> {
        if *self.mounted.read().await {
            return Err("Disco già montato".to_string());
        }

        *self.webdav.jwt_token.write().await = jwt_token;

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
                    });
                }
            }
            println!(
                "[VIRTUAL_DISK] update_files: {} DiskFileEntry -> {} FileEntry (con chiave)",
                n,
                entries.len()
            );
            self.webdav.update_files(entries).await;
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
}

#[cfg(target_os = "windows")]
mod windows;
