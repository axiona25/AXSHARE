//! Coordinatore disco virtuale — piattaforma-agnostica.
//! Delega a mac.rs (macFUSE) o windows.rs (WinFsp) in base all'OS.

use std::sync::Arc;
use tokio::sync::RwLock;

use crate::api_client::ApiClient;

pub struct VirtualDiskConfig {
    pub api_client: ApiClient,
    pub mount_point: String,       // es. "/Volumes/AXSHARE" o "Z:\"
    pub user_private_key: Vec<u8>, // chiave privata RSA — mai salvata su disco
}

pub struct VirtualDisk {
    config: Arc<RwLock<Option<VirtualDiskConfig>>>,
    mounted: Arc<RwLock<bool>>,
}

impl VirtualDisk {
    pub fn new() -> Self {
        Self {
            config: Arc::new(RwLock::new(None)),
            mounted: Arc::new(RwLock::new(false)),
        }
    }

    pub async fn mount(&self, config: VirtualDiskConfig) -> Result<(), String> {
        if *self.mounted.read().await {
            return Err("Disco già montato".to_string());
        }
        *self.config.write().await = Some(config);

        #[cfg(target_os = "macos")]
        {
            let config_guard = self.config.read().await;
            let cfg = config_guard.as_ref().unwrap();
            crate::virtual_disk::mac::mount(cfg).await?;
        }

        #[cfg(target_os = "windows")]
        {
            let _ = self.config.read().await;
            crate::virtual_disk::windows::mount().await?;
        }

        *self.mounted.write().await = true;
        log::info!("Virtual disk mounted");
        Ok(())
    }

    pub async fn unmount(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        crate::virtual_disk::mac::unmount().await?;

        #[cfg(target_os = "windows")]
        crate::virtual_disk::windows::unmount().await?;

        *self.mounted.write().await = false;
        *self.config.write().await = None;
        log::info!("Virtual disk unmounted");
        Ok(())
    }

    pub async fn is_mounted(&self) -> bool {
        *self.mounted.read().await
    }
}

#[cfg(target_os = "macos")]
mod mac;

#[cfg(target_os = "windows")]
mod windows;
