use tauri::{Manager, State};

use crate::virtual_disk::DiskFileEntry;
use crate::AppState;

/// Voce file/cartella già decifrata dal frontend (nomi e chiavi pronti).
#[derive(serde::Deserialize, Clone)]
pub struct DecryptedFileEntry {
    pub file_id: String,
    pub name: String,
    pub size: u64,
    pub is_folder: bool,
    pub folder_path: String,
    pub file_key_base64: Option<String>,
}

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn lock_session(state: State<AppState>) -> bool {
    let mut locked = state.is_locked.lock().unwrap();
    *locked = true;
    log::info!("Session locked");
    true
}

#[tauri::command]
pub fn unlock_session(state: State<AppState>) -> bool {
    let mut locked = state.is_locked.lock().unwrap();
    *locked = false;
    log::info!("Session unlocked");
    true
}

#[tauri::command]
pub fn is_session_locked(state: State<AppState>) -> bool {
    *state.is_locked.lock().unwrap()
}

#[tauri::command]
pub fn get_virtual_disk_status(state: State<AppState>) -> serde_json::Value {
    let mounted = *state.virtual_disk_mounted.lock().unwrap();
    serde_json::json!({ "mounted": mounted })
}

#[tauri::command]
pub async fn open_url_external(url: String) -> Result<(), String> {
    open::that(&url).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Window 'main' not found".to_string())?;
    window.open_devtools();
    Ok(())
}

#[tauri::command]
pub async fn set_main_window_size(app: tauri::AppHandle, width: u32, height: u32) -> Result<(), String> {
    use tauri::LogicalSize;
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Window 'main' not found".to_string())?;
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn mount_virtual_disk(
    _mount_point: String,
    jwt_token: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if *state.virtual_disk_mounted.lock().unwrap() {
        return Err("Disco già montato".to_string());
    }
    log::info!("[VIRTUAL DISK] Mounting...");
    let result = state.virtual_disk.mount(jwt_token).await?;
    *state.virtual_disk_mounted.lock().unwrap() = true;
    crate::file_protector::decrypt_all_local_files(state.local_db.as_ref()).await;
    log::info!("[VIRTUAL DISK] Mounted at {}", result);
    Ok(result)
}

#[tauri::command]
pub async fn unmount_virtual_disk(state: State<'_, AppState>) -> Result<(), String> {
    log::info!("[VIRTUAL DISK] Unmounting...");
    crate::file_protector::encrypt_all_local_files(state.local_db.as_ref()).await;
    state.virtual_disk.unmount().await?;
    *state.virtual_disk_mounted.lock().unwrap() = false;
    log::info!("[VIRTUAL DISK] Unmounted");
    Ok(())
}

#[tauri::command]
pub async fn is_disk_mounted(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.virtual_disk.is_mounted().await)
}

#[tauri::command]
pub async fn cleanup_disk_files(state: State<'_, AppState>) -> Result<u32, String> {
    state.local_db.remove_system_files()
}

fn icon_dir_for_encryptor(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(dir) = std::env::var("AXSHARE_ICONS_DIR") {
        return std::path::PathBuf::from(dir);
    }
    app.path()
        .resource_dir()
        .unwrap_or_else(|_| std::path::PathBuf::from("."))
        .join("icons")
}

/// Cifra i file locali tracciati (status=plain) in .axs con icona locked. Chiamato prima del logout.
#[tauri::command]
pub async fn encrypt_local_files_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[DISK] encrypt_local_files_command invoked (logout)");
    let icon_dir = icon_dir_for_encryptor(&app);
    println!("[DISK] icon_dir: {:?}, exists: {}", icon_dir, icon_dir.exists());
    crate::local_encryptor::encrypt_local_files(state.local_db.as_ref(), Some(icon_dir.as_path())).await;
    Ok(())
}

/// Decifra i file locali .axs (status=encrypted). Chiamato dopo PIN corretto al login.
#[tauri::command]
pub async fn decrypt_local_files_command(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let icon_dir = icon_dir_for_encryptor(&app);
    crate::local_encryptor::decrypt_local_files(state.local_db.as_ref(), Some(icon_dir.as_path())).await;
    Ok(())
}

#[tauri::command]
pub async fn update_disk_file_list(
    files: Vec<DiskFileEntry>,
    jwt_token: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[DISK] update_disk_file_list: {} file ricevuti", files.len());

    if let Some(t) = jwt_token {
        println!("[DISK] JWT token impostato (len={})", t.len());
        state.virtual_disk.set_jwt_token(t).await;
    } else {
        println!("[DISK] ATTENZIONE: jwt_token non passato");
    }

    for f in &files {
        println!(
            "[DISK]  - {} ({}) file_key_base64={}",
            f.name,
            f.file_id,
            if f.file_key_base64.is_some() {
                "presente"
            } else {
                "MANCANTE"
            }
        );
    }

    log::info!("[DISK] update_disk_file_list: chiamata virtual_disk.update_files con {} voci", files.len());
    state.virtual_disk.update_files(files).await?;
    log::info!("[DISK] update_disk_file_list: virtual_disk.update_files completato");
    Ok(())
}

#[tauri::command]
pub async fn update_disk_files_decrypted(
    entries: Vec<DecryptedFileEntry>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let disk_entries: Vec<DiskFileEntry> = entries
        .into_iter()
        .map(|e| DiskFileEntry {
            file_id: e.file_id,
            name: e.name,
            size: e.size,
            is_folder: e.is_folder,
            folder_path: e.folder_path,
            file_key_base64: e.file_key_base64,
        })
        .collect();
    state.virtual_disk.update_files(disk_entries).await
}

#[tauri::command]
pub async fn set_jwt_token(
    jwt_token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    println!("[DISK] set_jwt_token: len={}", jwt_token.len());
    state.virtual_disk.set_jwt_token(jwt_token).await;
    Ok(())
}

#[tauri::command]
pub async fn set_volume_icon(state: State<'_, AppState>) -> Result<(), String> {
    state.virtual_disk.apply_volume_icon().await;
    Ok(())
}

// ─── Sync offline & cache ────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_sync_token(
    jwt_token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.sync_engine.set_token(jwt_token).await;
    Ok(())
}

#[tauri::command]
pub async fn start_sync(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let progress = state.sync_engine.start_sync().await?;
    Ok(serde_json::to_value(progress).unwrap())
}

#[tauri::command]
pub async fn pause_sync(state: State<'_, AppState>) -> Result<(), String> {
    state.sync_engine.pause().await;
    Ok(())
}

#[tauri::command]
pub async fn resume_sync(state: State<'_, AppState>) -> Result<(), String> {
    state.sync_engine.resume().await;
    Ok(())
}

#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let progress = state.sync_engine.get_progress().await;
    Ok(serde_json::to_value(progress).unwrap())
}

#[tauri::command]
pub async fn enable_offline_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.sync_engine.enable_offline(&file_id).await
}

#[tauri::command]
pub async fn disable_offline_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.sync_engine.disable_offline(&file_id).await
}

#[tauri::command]
pub async fn list_offline_files(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let db = &state.local_db;
    let files: Vec<serde_json::Value> = db
        .list_all()
        .into_iter()
        .filter(|f| {
            // File cifrati o in chiaro fuori dal disco virtuale e dalla staging WebDAV
            (f.status == "encrypted" || f.status == "plain")
                && !f.local_path.contains("/Volumes/axshare-disk")
                && !f.local_path.contains("axshare_webdav")
        })
        .map(|f| {
            serde_json::json!({
                "local_path": f.local_path,
                "file_id": f.file_id,
                "original_name": f.original_name,
                "status": f.status,
            })
        })
        .collect();
    Ok(serde_json::to_value(files).unwrap())
}

#[tauri::command]
pub async fn get_cache_info(
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let size = state.sync_engine.get_cache_size_bytes().await;
    Ok(serde_json::json!({ "size_bytes": size, "size_mb": size / 1_048_576 }))
}

#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.sync_engine.clear_cache().await
}

// ─── Apri file con app nativa (Mac Preview, Word, ecc.) ─────────────────────

#[tauri::command]
pub async fn create_temp_dir() -> Result<String, String> {
    let temp = std::env::temp_dir().join("axshare_temp");
    std::fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    Ok(temp.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn mark_file_as_axshare(
    local_path: String,
    file_id: String,
    file_key_base64: String,
    original_name: String,
    content_hash: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = std::path::Path::new(&local_path);
    crate::xattr_manager::set_axshare_xattr(
        path,
        &file_id,
        &file_key_base64,
        &original_name,
    )?;
    state.local_db.upsert(&crate::local_db::LocalFileEntry {
        local_path,
        file_id,
        file_key_base64,
        original_name,
        content_hash,
        status: "plain".to_string(),
    })?;
    Ok(())
}

#[tauri::command]
pub async fn open_file_native(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Crea dir temp, scrive il file e restituisce il path completo. Evita di esporre fs alla WebView.
#[tauri::command]
pub async fn write_temp_file(name: String, contents: Vec<u8>) -> Result<String, String> {
    let temp = std::env::temp_dir().join("axshare_temp");
    std::fs::create_dir_all(&temp).map_err(|e| e.to_string())?;
    let name_safe = std::path::Path::new(&name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(name.as_str());
    let file_path = temp.join(name_safe);
    std::fs::write(&file_path, &contents).map_err(|e| e.to_string())?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_tray_status(
    app: tauri::AppHandle,
    state: State<AppState>,
    status: String,
) -> Result<(), String> {
    let tooltip = match status.as_str() {
        "connected" => "AXSHARE — Connesso",
        "syncing" => "AXSHARE — Sincronizzazione...",
        "error" => "AXSHARE — Errore connessione",
        "locked" => "AXSHARE — Sessione bloccata",
        _ => "AXSHARE",
    };
    let guard = state.tray_id.lock().unwrap();
    if let Some(ref id) = *guard {
        if let Some(tray) = app.tray_by_id(id) {
            tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_temp_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn read_temp_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn watch_temp_file(
    file_id: String,
    temp_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.file_watcher.watch_file(file_id, temp_path);
    Ok(())
}

#[tauri::command]
pub async fn unwatch_temp_file(
    temp_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.file_watcher.unwatch_file(&temp_path);
    Ok(())
}
