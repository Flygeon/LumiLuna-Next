pub mod scan;
pub mod metadata;
pub mod song;
pub mod thumbnail;

use std::sync::Mutex;
use std::collections::HashMap;
use serde::Serialize;

/// 全局数据库句柄
pub struct DbState(pub Mutex<rusqlite::Connection>);

/// 扫描任务注册表
pub struct JobState(pub Mutex<HashMap<String, ScanJobInfo>>);

#[derive(Clone, Serialize)]
pub struct ScanJobInfo {
    pub job_id: String,
    pub stage: String,
    pub done: usize,
    pub total: usize,
    pub percent: f64,
}

pub fn init_db(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL,
          type TEXT NOT NULL,
          size INTEGER,
          mtime INTEGER,
          scanned_at INTEGER,
          deleted INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_files_type ON files(type);
        CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
        CREATE TABLE IF NOT EXISTS media_metadata (
          file_id TEXT PRIMARY KEY,
          title TEXT, artist TEXT, album TEXT, duration_ms INTEGER,
          width INTEGER, height INTEGER, codec TEXT, fps REAL,
          taken_at INTEGER, camera TEXT, iso INTEGER, gps_lat REAL, gps_lng REAL,
          author TEXT, language TEXT, page_count INTEGER, chapter_count INTEGER
        );
        CREATE TABLE IF NOT EXISTS book_progress (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          book_id TEXT NOT NULL,
          location TEXT,
          page INTEGER,
          percent REAL,
          updated_at INTEGER NOT NULL
        );
        "#,
    )?;
    Ok(())
}
