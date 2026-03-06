//! Extended attributes per file AXSHARE (fallback se il DB viene perso).

use std::path::Path;

const XATTR_FILE_ID: &str = "com.axshare.file_id";
const XATTR_FILE_KEY: &str = "com.axshare.file_key_base64";
const XATTR_ORIGINAL_NAME: &str = "com.axshare.original_name";

/// Imposta gli xattr AXSHARE sul file (fallback per DB perso/file spostato).
pub fn set_axshare_xattr(
    path: &Path,
    file_id: &str,
    file_key_base64: &str,
    original_name: &str,
) -> Result<(), String> {
    xattr::set(path, XATTR_FILE_ID, file_id.as_bytes()).map_err(|e| e.to_string())?;
    xattr::set(path, XATTR_FILE_KEY, file_key_base64.as_bytes()).map_err(|e| e.to_string())?;
    xattr::set(path, XATTR_ORIGINAL_NAME, original_name.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

/// Legge gli xattr AXSHARE (per ripristinare voce nel DB / watcher locale).
pub fn get_axshare_xattr(path: &Path) -> Option<(String, String, String)> {
    let id = xattr::get(path, XATTR_FILE_ID).ok()??;
    let key = xattr::get(path, XATTR_FILE_KEY).ok()??;
    let name = xattr::get(path, XATTR_ORIGINAL_NAME).ok()??;
    Some((
        String::from_utf8_lossy(&id).to_string(),
        String::from_utf8_lossy(&key).to_string(),
        String::from_utf8_lossy(&name).to_string(),
    ))
}
