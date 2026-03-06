use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

#[derive(serde::Deserialize)]
pub struct NotificationPayload {
    pub title: String,
    pub body: String,
    #[allow(dead_code)]
    pub icon: Option<String>,
}

#[tauri::command]
pub fn show_notification(app: AppHandle, payload: NotificationPayload) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&payload.title)
        .body(&payload.body)
        .show()
        .map_err(|e| e.to_string())
}

/// Notifiche predefinite AXSHARE
#[tauri::command]
pub fn notify_file_shared(
    app: AppHandle,
    sender: String,
    filename: String,
) -> Result<(), String> {
    app.notification()
        .builder()
        .title("File condiviso con te")
        .body(format!("{} ha condiviso \"{}\" con te", sender, filename))
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notify_permission_expiring(
    app: AppHandle,
    filename: String,
    minutes: u64,
) -> Result<(), String> {
    let body = if minutes < 60 {
        format!(
            "Il permesso su \"{}\" scade tra {} minuti",
            filename, minutes
        )
    } else {
        format!(
            "Il permesso su \"{}\" scade tra {} ore",
            filename,
            minutes / 60
        )
    };
    app.notification()
        .builder()
        .title("Permesso in scadenza")
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notify_file_destroyed(app: AppHandle, filename: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title("File auto-distrutto")
        .body(format!("\"{}\" è stato auto-distrutto", filename))
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn notify_sync_complete(app: AppHandle, count: u32) -> Result<(), String> {
    app.notification()
        .builder()
        .title("Sincronizzazione completata")
        .body(format!("{} file sincronizzati", count))
        .show()
        .map_err(|e| e.to_string())
}
