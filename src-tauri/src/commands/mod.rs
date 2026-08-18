pub mod app;
pub mod book;
pub mod ffmpeg;
pub mod metadata;
pub mod scan;
pub mod smtc;
pub mod song;
pub mod stats;
pub mod thumbnail;

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::Serialize;

/// 全局数据库句柄
pub struct DbState(pub Mutex<rusqlite::Connection>);

/// 扫描任务注册表
pub struct JobState(pub Mutex<HashMap<String, ScanJob>>);

/// 单个扫描任务：进度快照 + 取消标志
pub struct ScanJob {
    pub info: ScanJobInfo,
    pub cancel: Arc<AtomicBool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanJobInfo {
    pub job_id: String,
    /// enumerate | parse | store | done | cancelled | error
    pub stage: String,
    pub done: usize,
    pub total: usize,
    pub percent: f64,
    pub current_path: String,
    /// 本次扫描新增 / 更新 / 移除的条目数
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub error: Option<String>,
}

impl ScanJobInfo {
    pub fn new(job_id: String) -> Self {
        Self {
            job_id,
            stage: "pending".into(),
            done: 0,
            total: 0,
            percent: 0.0,
            current_path: String::new(),
            added: 0,
            updated: 0,
            removed: 0,
            error: None,
        }
    }
}

/// 当前 schema 版本。递增后在 `migrate` 中追加对应分支。
const SCHEMA_VERSION: i64 = 2;

/// 建表 + 版本化迁移。对已存在的库是幂等的。
pub fn init_db(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    // WAL 提升并发读写表现；NORMAL 同步级别对媒体索引足够安全。
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    conn.pragma_update(None, "foreign_keys", "ON")?;

    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS files (
          id          TEXT PRIMARY KEY,
          path        TEXT NOT NULL UNIQUE,
          parent      TEXT NOT NULL DEFAULT '',
          name        TEXT NOT NULL DEFAULT '',
          ext         TEXT NOT NULL DEFAULT '',
          type        TEXT NOT NULL,
          size        INTEGER NOT NULL DEFAULT 0,
          mtime       INTEGER NOT NULL DEFAULT 0,
          scanned_at  INTEGER NOT NULL DEFAULT 0,
          parsed_at   INTEGER NOT NULL DEFAULT 0,
          deleted     INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_files_type   ON files(type, deleted);
        CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent);
        CREATE INDEX IF NOT EXISTS idx_files_mtime  ON files(mtime);

        CREATE TABLE IF NOT EXISTS media_metadata (
          file_id       TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          title         TEXT,
          artist        TEXT,
          album_artist  TEXT,
          album         TEXT,
          genre         TEXT,
          year          INTEGER,
          track_no      INTEGER,
          disc_no       INTEGER,
          duration_ms   INTEGER,
          bitrate       INTEGER,
          sample_rate   INTEGER,
          channels      INTEGER,
          width         INTEGER,
          height        INTEGER,
          orientation   INTEGER,
          codec         TEXT,
          fps           REAL,
          taken_at      INTEGER,
          camera        TEXT,
          lens          TEXT,
          iso           INTEGER,
          exposure      TEXT,
          f_number      REAL,
          focal_length  REAL,
          gps_lat       REAL,
          gps_lng       REAL,
          author        TEXT,
          publisher     TEXT,
          language      TEXT,
          page_count    INTEGER,
          chapter_count INTEGER,
          has_cover     INTEGER NOT NULL DEFAULT 0,
          has_lyrics    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS book_progress (
          book_id    TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          location   TEXT,
          page       INTEGER,
          percent    REAL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS favorites (
          file_id    TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS history (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          file_id   TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
          played_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_history_time ON history(played_at DESC);
        "#,
    )?;

    migrate(conn)?;
    Ok(())
}

fn migrate(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if current >= SCHEMA_VERSION {
        return Ok(());
    }
    // v0 -> v1：初始 schema 已由上面的 CREATE TABLE IF NOT EXISTS 建立。
    if current < 1 {
        conn.pragma_update(None, "user_version", 1)?;
    }
    // v1 -> v2：听歌时长统计
    if current < 2 {
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS play_session (
              id TEXT PRIMARY KEY,
              track_id TEXT NOT NULL,
              source TEXT NOT NULL,
              started_at INTEGER NOT NULL,
              ended_at INTEGER,
              listened_ms INTEGER NOT NULL DEFAULT 0,
              completed INTEGER NOT NULL DEFAULT 0,
              quality_br INTEGER,
              title TEXT,
              artist TEXT,
              album TEXT,
              file_path TEXT,
              file_name TEXT,
              content_hash TEXT,
              cover_url TEXT,
              src_url TEXT
            );
            CREATE TABLE IF NOT EXISTS listen_daily (
              day TEXT PRIMARY KEY,
              play_count INTEGER NOT NULL DEFAULT 0,
              unique_tracks INTEGER NOT NULL DEFAULT 0,
              total_ms INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS listen_day_track (
              day TEXT NOT NULL,
              track_id TEXT NOT NULL,
              PRIMARY KEY (day, track_id)
            );
            CREATE INDEX IF NOT EXISTS idx_session_started ON play_session(started_at);
            CREATE INDEX IF NOT EXISTS idx_session_track ON play_session(track_id);
            "#,
        )?;
        conn.pragma_update(None, "user_version", 2)?;
    }
    Ok(())
}

/// 当前 Unix 秒
pub fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 当前 Unix 毫秒
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
