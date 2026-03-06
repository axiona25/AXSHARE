use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

mod api_client;
mod autolock;
mod commands;
pub mod crypto_fuse;
mod dragdrop;
mod keychain;
mod notifications;
pub mod sync;
mod tray;
mod virtual_disk;

pub use autolock::AutoLock;
pub use commands::*;

/// Stato globale condiviso tra comandi Tauri
pub struct AppState {
    pub is_locked: Mutex<bool>,
    pub virtual_disk_mounted: Mutex<bool>,
    pub autolock: AutoLock,
    pub virtual_disk: virtual_disk::VirtualDisk,
    pub sync_engine: sync::SyncEngine,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(AppState {
            is_locked: Mutex::new(false),
            virtual_disk_mounted: Mutex::new(false),
            autolock: autolock::AutoLock::new(),
            virtual_disk: virtual_disk::VirtualDisk::new(),
            sync_engine: sync::SyncEngine::new(api_client::ApiClient::new(
                "http://localhost:8000/api/v1",
            )),
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_version,
            commands::lock_session,
            commands::unlock_session,
            commands::is_session_locked,
            commands::get_virtual_disk_status,
            commands::open_url_external,
            keychain::save_token,
            keychain::get_token,
            keychain::delete_token,
            autolock::set_autolock_timeout,
            autolock::set_autolock_enabled,
            autolock::register_user_activity,
            notifications::show_notification,
            notifications::notify_file_shared,
            notifications::notify_permission_expiring,
            notifications::notify_file_destroyed,
            notifications::notify_sync_complete,
            dragdrop::read_file_for_upload,
            dragdrop::get_file_metadata,
            dragdrop::pick_files_dialog,
            commands::mount_virtual_disk,
            commands::unmount_virtual_disk,
            commands::set_sync_token,
            commands::start_sync,
            commands::pause_sync,
            commands::resume_sync,
            commands::get_sync_status,
            commands::enable_offline_file,
            commands::disable_offline_file,
            commands::list_offline_files,
            commands::get_cache_info,
            commands::clear_cache,
        ])
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            let state = app.state::<AppState>();
            state.autolock.start_monitor(app.handle().clone());
            dragdrop::setup_drag_drop(&app.handle());
            tray::setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let window = window.clone();
                tauri::async_runtime::spawn(async move {
                    graceful_shutdown(&window).await;
                    let _ = window.close();
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error running AXSHARE desktop app");
}

async fn graceful_shutdown(window: &tauri::Window) {
    log::info!("Avvio graceful shutdown desktop...");
    if let Some(state) = window.app_handle().try_state::<AppState>() {
        state.sync_engine.stop().await;
        log::info!("Sync engine fermato");
    }
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        flush_pending_operations(),
    )
    .await;
    log::info!("Graceful shutdown completato");
}

async fn flush_pending_operations() {
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
}
