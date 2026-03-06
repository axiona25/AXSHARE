//! Gestione token JWT nel Keychain OS (macOS Keychain / Windows Credential Manager)
//! Le chiavi crittografiche NON passano per Rust — restano in IndexedDB del browser

use keyring::Entry;

const SERVICE_NAME: &str = "com.axshare.app";

#[tauri::command]
pub fn save_token(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_token(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    Ok(entry.get_password().ok())
}

#[tauri::command]
pub fn delete_token(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE_NAME, &key).map_err(|e| e.to_string())?;
    entry.delete_password().map_err(|e| e.to_string())
}
