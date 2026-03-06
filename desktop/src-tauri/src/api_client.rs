//! Client HTTP Rust per chiamate al backend FastAPI.
//! Usato dal processo FUSE (non dal WebView).

use reqwest::Client;
use serde::Deserialize;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct ApiClient {
    client: Client,
    base_url: String,
    token: Arc<RwLock<Option<String>>>,
}

impl ApiClient {
    pub fn new(base_url: &str) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap(),
            base_url: base_url.to_string(),
            token: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_token(&self, token: String) {
        *self.token.write().await = Some(token);
    }

    pub async fn clear_token(&self) {
        *self.token.write().await = None;
    }

    async fn auth_header(&self) -> Option<String> {
        self.token
            .read()
            .await
            .as_ref()
            .map(|t| format!("Bearer {}", t))
    }

    /// Lista cartelle root dell'utente
    pub async fn list_folders(&self) -> Result<Vec<FolderMeta>, String> {
        let auth = self.auth_header().await.ok_or("Not authenticated")?;
        let resp = self
            .client
            .get(format!("{}/folders/", self.base_url))
            .header("Authorization", auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        resp.json().await.map_err(|e| e.to_string())
    }

    /// Lista sottocartelle di una cartella
    pub async fn list_children(&self, folder_id: &str) -> Result<Vec<FolderMeta>, String> {
        let auth = self.auth_header().await.ok_or("Not authenticated")?;
        let resp = self
            .client
            .get(format!("{}/folders/{}/children", self.base_url, folder_id))
            .header("Authorization", auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        resp.json().await.map_err(|e| e.to_string())
    }

    /// Lista file in una cartella
    pub async fn list_files(&self, folder_id: &str) -> Result<Vec<FileMeta>, String> {
        let auth = self.auth_header().await.ok_or("Not authenticated")?;
        let resp = self
            .client
            .get(format!("{}/folders/{}/files", self.base_url, folder_id))
            .header("Authorization", auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        resp.json().await.map_err(|e| e.to_string())
    }

    /// Scarica blob cifrato di un file
    pub async fn download_encrypted(&self, file_id: &str) -> Result<Vec<u8>, String> {
        let auth = self.auth_header().await.ok_or("Not authenticated")?;
        let resp = self
            .client
            .get(format!("{}/files/{}/download", self.base_url, file_id))
            .header("Authorization", auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        resp.bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| e.to_string())
    }

    /// Ottieni chiave file cifrata
    pub async fn get_file_key(&self, file_id: &str) -> Result<FileKeyResponse, String> {
        let auth = self.auth_header().await.ok_or("Not authenticated")?;
        let resp = self
            .client
            .get(format!("{}/files/{}/key", self.base_url, file_id))
            .header("Authorization", auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        resp.json().await.map_err(|e| e.to_string())
    }

    /// Eventi sync (share_revoked, guest_revoked) per propagazione revoca su tutti i dispositivi
    pub async fn get_sync_events(&self, since: &str) -> Result<Vec<SyncEvent>, String> {
        let auth = self.auth_header().await.ok_or("Not authenticated")?;
        let resp = self
            .client
            .get(format!("{}/sync/events", self.base_url))
            .query(&[("since", since)])
            .header("Authorization", auth)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        resp.json().await.map_err(|e| e.to_string())
    }
}

#[derive(Debug, Deserialize, Clone)]
pub struct FolderMeta {
    pub id: String,
    pub name_encrypted: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub owner_id: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct FileMeta {
    pub id: String,
    pub name_encrypted: String,
    #[serde(rename = "size")]
    pub size_bytes: u64,
    #[serde(default)]
    pub owner_id: String,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub is_destroyed: bool,
}

#[derive(Debug, Deserialize)]
pub struct FileKeyResponse {
    pub file_key_encrypted: String,
    pub encryption_iv: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct SyncEvent {
    pub id: String,
    pub file_id: Option<String>,
    pub event_type: String,
    pub created_at: String,
    #[serde(default)]
    pub payload: Option<String>,
}
