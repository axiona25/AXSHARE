//! DB SQLite locale per tracking file AXSHARE (path, file_id, key, status).
//! Usato con xattr come fallback.

use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct LocalDb {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone)]
pub struct LocalFileEntry {
    pub local_path: String,
    pub file_id: String,
    pub file_key_base64: String,
    pub original_name: String,
    pub content_hash: Option<String>,
    pub status: String, // "plain" | "encrypted"
}

impl LocalDb {
    /// Crea o apre il DB SQLite. Path: `data_local_dir()/axshare/local_files.db`
    /// (es. macOS: ~/Library/Application Support/axshare/local_files.db — persistente).
    pub fn new() -> Result<Self, String> {
        let db_path = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("axshare")
            .join("local_files.db");

        println!("[LOCAL_DB] Path DB: {}", db_path.display());

        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS local_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                local_path TEXT NOT NULL UNIQUE,
                file_id TEXT NOT NULL,
                file_key_base64 TEXT NOT NULL,
                original_name TEXT NOT NULL,
                content_hash TEXT,
                status TEXT NOT NULL DEFAULT 'plain',
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
            CREATE INDEX IF NOT EXISTS idx_status ON local_files(status);
            CREATE INDEX IF NOT EXISTS idx_file_id ON local_files(file_id);
            CREATE INDEX IF NOT EXISTS idx_content_hash ON local_files(content_hash);
            ",
        )
        .map_err(|e| e.to_string())?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn upsert(&self, entry: &LocalFileEntry) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO local_files
                (local_path, file_id, file_key_base64, original_name,
                 content_hash, status, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,strftime('%s','now'))
             ON CONFLICT(local_path) DO UPDATE SET
                file_key_base64=excluded.file_key_base64,
                content_hash=excluded.content_hash,
                status=excluded.status,
                updated_at=strftime('%s','now')",
            params![
                entry.local_path,
                entry.file_id,
                entry.file_key_base64,
                entry.original_name,
                entry.content_hash,
                entry.status,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_by_status(&self, status: &str) -> Vec<LocalFileEntry> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return vec![],
        };
        let mut stmt = match conn.prepare(
            "SELECT local_path, file_id, file_key_base64,
                    original_name, content_hash, status
             FROM local_files WHERE status = ?1",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map(params![status], |row| {
            Ok(LocalFileEntry {
                local_path: row.get(0)?,
                file_id: row.get(1)?,
                file_key_base64: row.get(2)?,
                original_name: row.get(3)?,
                content_hash: row.get(4)?,
                status: row.get(5)?,
            })
        })
        .and_then(|m| m.collect::<Result<Vec<_>, _>>())
        .unwrap_or_default()
    }

    pub fn list_all(&self) -> Vec<LocalFileEntry> {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return vec![],
        };
        let mut stmt = match conn.prepare(
            "SELECT local_path, file_id, file_key_base64,
                    original_name, content_hash, status
             FROM local_files",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map([], |row| {
            Ok(LocalFileEntry {
                local_path: row.get(0)?,
                file_id: row.get(1)?,
                file_key_base64: row.get(2)?,
                original_name: row.get(3)?,
                content_hash: row.get(4)?,
                status: row.get(5)?,
            })
        })
        .and_then(|m| m.collect::<Result<Vec<_>, _>>())
        .unwrap_or_default()
    }

    pub fn update_status(
        &self,
        local_path: &str,
        new_path: &str,
        status: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE local_files SET
                local_path=?1, status=?2,
                updated_at=strftime('%s','now')
             WHERE local_path=?3",
            params![new_path, status, local_path],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove(&self, local_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM local_files WHERE local_path=?1", params![local_path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Rimuove dal DB le voci relative a file di sistema, temporanei Office e nomi non decifrati (file_*).
    pub fn remove_system_files(&self) -> Result<u32, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count = conn
            .execute(
                "DELETE FROM local_files WHERE
                 original_name LIKE '._%' OR original_name = '.DS_Store' OR original_name LIKE '.%'
                 OR original_name LIKE 'file_%' OR original_name LIKE '~$%' OR original_name LIKE '~WRL%'
                 OR original_name LIKE '%.tmp' OR original_name LIKE '%.TMP'",
                [],
            )
            .map_err(|e| e.to_string())?;
        Ok(count as u32)
    }

    pub fn count_by_status(&self, status: &str) -> usize {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return 0,
        };
        conn.query_row(
            "SELECT COUNT(*) FROM local_files WHERE status=?1",
            params![status],
            |row| row.get::<_, i64>(0),
        )
        .map(|n| n as usize)
        .unwrap_or(0)
    }

    /// Cerca una voce per hash del contenuto (per riconoscere copie dal disco WebDAV).
    pub fn find_by_hash(&self, hash: &str) -> Option<LocalFileEntry> {
        let conn = self.conn.lock().ok()?;
        conn.query_row(
            "SELECT local_path, file_id, file_key_base64,
                    original_name, content_hash, status
             FROM local_files WHERE content_hash = ?1 LIMIT 1",
            params![hash],
            |row| {
                Ok(LocalFileEntry {
                    local_path: row.get(0)?,
                    file_id: row.get(1)?,
                    file_key_base64: row.get(2)?,
                    original_name: row.get(3)?,
                    content_hash: row.get(4)?,
                    status: row.get(5)?,
                })
            },
        )
        .ok()
    }
}
