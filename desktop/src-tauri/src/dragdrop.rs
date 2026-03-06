//! Gestione drag & drop file dal filesystem nell'app.
//! Tauri 2 supporta DragDrop events via window events.
//! I path vengono inviati al frontend che gestisce upload.

use tauri::AppHandle;

pub fn setup_drag_drop(_app: &AppHandle) {
    // Tauri 2: DragDrop events sono gestiti via window.on_drag_drop_event (frontend)
    // Il frontend riceve l'evento drag-drop con i path tramite @tauri-apps/api
    log::info!("Drag & drop handler registered");
}

/// Comando per leggere file dal filesystem (per upload dopo drag & drop)
#[tauri::command]
pub async fn read_file_for_upload(path: String) -> Result<Vec<u8>, String> {
    tokio::fs::read(&path).await.map_err(|e| {
        format!("Errore lettura file {}: {}", path, e)
    })
}

/// Comando per ottenere metadata del file
#[tauri::command]
pub async fn get_file_metadata(path: String) -> Result<serde_json::Value, String> {
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| e.to_string())?;

    let filename = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown")
        .to_string();

    Ok(serde_json::json!({
        "path": path,
        "filename": filename,
        "size": meta.len(),
        "is_file": meta.is_file(),
    }))
}

/// Apri dialog di selezione file nativo
#[tauri::command]
pub async fn pick_files_dialog(app: AppHandle, multiple: bool) -> Result<Vec<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let paths = if multiple {
        app.dialog()
            .file()
            .blocking_pick_files()
            .unwrap_or_default()
    } else {
        app.dialog()
            .file()
            .blocking_pick_file()
            .map(|p| vec![p])
            .unwrap_or_default()
    };

    Ok(paths.into_iter().map(|p| p.to_string()).collect())
}
