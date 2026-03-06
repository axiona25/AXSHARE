use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::mpsc;

mod api_client;
mod autolock;
mod axshare_file_handler;
mod commands;
pub mod crypto_fuse;
mod dragdrop;
mod file_protector;
mod file_watcher;
mod file_watcher_local;
mod keychain;
mod local_db;
mod notifications;
pub mod sync;
mod tray;
mod virtual_disk;
mod xattr_manager;

pub use autolock::AutoLock;
pub use commands::*;
pub use file_watcher::{FileWatcher, WatchedFile};

/// Stato globale condiviso tra comandi Tauri
pub struct AppState {
    pub is_locked: Mutex<bool>,
    pub virtual_disk_mounted: Mutex<bool>,
    pub autolock: AutoLock,
    pub virtual_disk: virtual_disk::VirtualDisk,
    pub local_db: Arc<local_db::LocalDb>,
    pub sync_engine: sync::SyncEngine,
    pub tray_id: Mutex<Option<tauri::tray::TrayIconId>>,
    pub file_watcher: Arc<FileWatcher>,
    pub file_watcher_rx: Mutex<Option<mpsc::Receiver<WatchedFile>>>,
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
        .manage({
            let (tx, rx) = mpsc::channel::<WatchedFile>(100);
            let file_watcher = Arc::new(FileWatcher::new(tx));
            let local_db = Arc::new(local_db::LocalDb::new().expect("DB locale fallito"));
            let virtual_disk = virtual_disk::VirtualDisk::new(local_db.clone());
            AppState {
                is_locked: Mutex::new(false),
                virtual_disk_mounted: Mutex::new(false),
                autolock: autolock::AutoLock::new(),
                virtual_disk,
                local_db,
                sync_engine: sync::SyncEngine::new(api_client::ApiClient::new(
                    "http://localhost:8000/api/v1",
                )),
                tray_id: Mutex::new(None),
                file_watcher,
                file_watcher_rx: Mutex::new(Some(rx)),
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_version,
            commands::lock_session,
            commands::unlock_session,
            commands::is_session_locked,
            commands::get_virtual_disk_status,
            commands::open_url_external,
            commands::open_devtools,
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
            commands::is_disk_mounted,
            commands::update_disk_file_list,
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
            commands::create_temp_dir,
            commands::write_temp_file,
            commands::open_file_native,
            commands::mark_file_as_axshare,
            commands::cleanup_disk_files,
            commands::delete_temp_file,
            commands::set_tray_status,
            commands::watch_temp_file,
            commands::unwatch_temp_file,
            commands::read_temp_file,
        ])
        .setup(|app| {
            #[cfg(any(windows, target_os = "linux"))]
            {
                let _ = app.deep_link().register_all();
            }
            let (file_watcher, rx) = {
                let state = app.state::<AppState>();
                let fw = state.file_watcher.clone();
                let mut guard = state.file_watcher_rx.lock().unwrap();
                let r = guard.take();
                (fw, r)
            };
            file_watcher.start();
            if let Some(mut rx) = rx {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    while let Some(wf) = rx.recv().await {
                        log::info!(
                            "[FILE_WATCHER] File modificato: {} ({})",
                            wf.temp_path,
                            wf.file_id
                        );
                        let payload = serde_json::json!({
                            "file_id": wf.file_id,
                            "temp_path": wf.temp_path,
                        });
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.emit("file-modified", payload);
                        }
                    }
                });
            }

            let db_for_watcher = app.state::<AppState>().local_db.clone();
            app.state::<AppState>().autolock.start_monitor(app.handle().clone());
            dragdrop::setup_drag_drop(&app.handle());
            tray::setup_tray(app)?;
            file_watcher_local::start_local_file_watcher(db_for_watcher);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                #[cfg(target_os = "macos")]
                crate::tray::set_activation_policy(window.app_handle(), false);
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error building AXSHARE desktop app")
        .run(|app, event| {
            match event {
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                    if let Some(state) = app.try_state::<AppState>() {
                        #[cfg(target_os = "macos")]
                        {
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
                            log::info!("[EXIT] Disco smontato forzatamente");
                        }
                        tauri::async_runtime::block_on(async {
                            let _ = state.virtual_disk.unmount().await;
                        });
                    }
                }
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Opened { urls } => {
                    for url in urls {
                        if let Ok(path) = url.to_file_path() {
                            if path.extension().map(|e| e == "axshare").unwrap_or(false) {
                                axshare_file_handler::open_axshare_file(&path);
                            }
                        }
                    }
                }
                _ => {}
            }
        });
}

