use tauri::State;

use crate::api_client::ApiClient;
use crate::virtual_disk::VirtualDiskConfig;
use crate::AppState;

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
pub async fn mount_virtual_disk(
    mount_point: String,
    jwt_token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if *state.virtual_disk_mounted.lock().unwrap() {
        return Err("Disco già montato".to_string());
    }

    let api = ApiClient::new("http://localhost:8000/api/v1");
    api.set_token(jwt_token).await;

    let config = VirtualDiskConfig {
        api_client: api,
        mount_point: mount_point.clone(),
        user_private_key: vec![], // TODO: ricevere da keychain in TASK 7.4
    };

    state.virtual_disk.mount(config).await?;
    *state.virtual_disk_mounted.lock().unwrap() = true;
    log::info!("Virtual disk mounted at {}", mount_point);
    Ok(())
}

#[tauri::command]
pub async fn unmount_virtual_disk(state: State<'_, AppState>) -> Result<(), String> {
    state.virtual_disk.unmount().await?;
    *state.virtual_disk_mounted.lock().unwrap() = false;
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
    let files = state.sync_engine.list_offline_files().await;
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
