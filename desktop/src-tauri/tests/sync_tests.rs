//! Test unitari per sync manifest e progress.

use axshare_desktop_lib::sync::*;
use std::collections::HashMap;

#[test]
fn test_default_manifest() {
    let manifest = SyncManifest {
        version: 1,
        last_full_sync: 0,
        files: HashMap::new(),
    };
    assert_eq!(manifest.version, 1);
    assert_eq!(manifest.files.len(), 0);
}

#[test]
fn test_file_manifest_serialization() {
    let entry = FileManifest {
        file_id: "test-id".to_string(),
        filename_encrypted: "enc_name".to_string(),
        version: 2,
        size_bytes: 1024,
        last_sync: 1700000000,
        local_modified: None,
        etag: Some("etag123".to_string()),
        offline_enabled: true,
    };
    let json = serde_json::to_string(&entry).unwrap();
    let deserialized: FileManifest = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.file_id, "test-id");
    assert!(deserialized.offline_enabled);
    assert_eq!(deserialized.version, 2);
}

#[tokio::test]
async fn test_sync_progress_default() {
    let p = SyncProgress {
        status: "idle".to_string(),
        current_file: None,
        total: 0,
        done: 0,
        last_sync: 0,
    };
    assert_eq!(p.status, "idle");
}
