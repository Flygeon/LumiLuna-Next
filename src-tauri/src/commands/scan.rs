use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use walkdir::WalkDir;

use crate::commands::{DbState, JobState, ScanJobInfo, init_db};

#[derive(Deserialize)]
pub struct ScanConfig {
    pub dirs: Vec<String>,
    #[serde(default)]
    pub max_depth: Option<usize>,
}

#[derive(Serialize)]
pub struct ScanStartResult {
    pub job_id: String,
}

const WHITELIST: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "heic",
    "mp4", "mov", "mkv", "avi", "flv",
    "mp3", "flac", "m4a", "ogg", "wav",
    "epub", "pdf",
];

fn file_type(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "heic" => "image",
        "mp4" | "mov" | "mkv" | "avi" | "flv" => "video",
        "mp3" | "flac" | "m4a" | "ogg" | "wav" => "audio",
        "epub" | "pdf" => "book",
        _ => "other",
    }
}

fn xxh3_hex(s: &str) -> String {
    let h = xxhash_rust::xxh3::xxh3_64(s.as_bytes());
    format!("{:016x}", h)
}


/// 启动异步扫描任务（tokio::spawn）
#[tauri::command]
pub fn scan_start(
    app: tauri::AppHandle,
    state: State<'_, JobState>,
    config: ScanConfig,
) -> ScanStartResult {
    let job_id = format!("scan-{}", uuid4());
    {
        let mut jobs = state.0.lock().unwrap();
        jobs.insert(
            job_id.clone(),
            ScanJobInfo {
                job_id: job_id.clone(),
                stage: "pending".into(),
                done: 0,
                total: 0,
                percent: 0.0,
            },
        );
    }
    let job_id_clone = job_id.clone();
    let config_clone = config;
    tauri::async_runtime::spawn(async move {
        run_scan(app, job_id_clone, config_clone).await;
    });
    ScanStartResult { job_id }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressPayload {
    pub job_id: String,
    pub stage: String,
    pub done: usize,
    pub total: usize,
    pub percent: f64,
    pub current_path: String,
}

fn uuid4() -> String {
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).unwrap_or_default();
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        buf[0], buf[1], buf[2], buf[3], buf[4], buf[5], buf[6], buf[7],
        buf[8], buf[9], buf[10], buf[11], buf[12], buf[13], buf[14], buf[15]
    )
}

async fn run_scan(app: tauri::AppHandle, job_id: String, config: ScanConfig) {
    let state = app.state::<JobState>();
    let mut paths: Vec<(String, String)> = Vec::new(); // (path, type)

    update_job(&state, &job_id, "enumerate", 0, 0, 0.0, "");
    for dir in &config.dirs {
        let walker = WalkDir::new(dir)
            .max_depth(config.max_depth.unwrap_or(8))
            .into_iter()
            .filter_entry(|e| {
                // 跳过隐藏目录
                if e.file_type().is_dir() {
                    let name = e.file_name().to_string_lossy();
                    !name.starts_with('.')
                } else {
                    true
                }
            });
        for entry in walker.filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let path = entry.path();
                let ext = path
                    .extension()
                    .map(|e| e.to_string_lossy().to_lowercase())
                    .unwrap_or_default();
                if WHITELIST.contains(&ext.as_str()) {
                    let p = path.to_string_lossy().to_string();
                    let t = file_type(&ext);
                    paths.push((p, t.to_string()));
                }
            }
        }
    }

    let total = paths.len();
    update_job(&state, &job_id, "metadata", 0, total, 0.0, "");

    // 入库
    let _tx_result = {
        let db = app.state::<DbState>();
        let mut guard = db.0.lock().unwrap();
        // ensure schema
        let _ = init_db(&guard);
            // rusqlite transaction needs mutable conn
            let tx = guard.transaction();
            match tx {
                Ok(tx) => {
                    {
                        let mut done = 0usize;
                        for (path, typ) in &paths {
                            let id = xxh3_hex(path);
                            let mtime = std::fs::metadata(path)
                                .map(|m| {
                                    m.modified()
                                        .map(|t| {
                                            t.duration_since(std::time::UNIX_EPOCH)
                                                .map(|d| d.as_secs() as i64)
                                                .unwrap_or(0)
                                        })
                                        .unwrap_or(0)
                                })
                                .unwrap_or(0);
                            let size = std::fs::metadata(path).map(|m| m.len() as i64).unwrap_or(0);
                            let _ = tx.execute(
                                "INSERT INTO files (id, path, type, size, mtime, scanned_at, deleted)
                                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
                                 ON CONFLICT(id) DO UPDATE SET
                                   size=excluded.size, mtime=excluded.mtime, scanned_at=excluded.scanned_at",
                                rusqlite::params![id, path, typ, size, mtime, chrono_now()],
                            );
                            done += 1;
                            if done % 500 == 0 {
                                update_job(&state, &job_id, "store", done, total,
                                    (done as f64 / total.max(1) as f64) * 100.0, path);
                            }
                        }
                    }
                    tx.commit()
                }
                Err(e) => Err(e),
            }
    };

    update_job(&state, &job_id, "done", total, total, 100.0, "");
    let _ = app.emit("scan:progress", ScanProgressPayload {
        job_id: job_id.clone(),
        stage: "done".into(),
        done: total,
        total,
        percent: 100.0,
        current_path: String::new(),
    });
}

fn update_job(
    state: &State<'_, JobState>,
    job_id: &str,
    stage: &str,
    done: usize,
    total: usize,
    percent: f64,
    path: &str,
) {
    if let Ok(mut jobs) = state.0.lock() {
        if let Some(j) = jobs.get_mut(job_id) {
            j.stage = stage.to_string();
            j.done = done;
            j.total = total;
            j.percent = percent;
        }
    }
    let _ = path;
}

fn chrono_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// 取消扫描
#[tauri::command]
pub fn scan_cancel(state: State<'_, JobState>, job_id: String) {
    let mut jobs = state.0.lock().unwrap();
    jobs.remove(&job_id);
}

/// 查询扫描状态
#[tauri::command]
pub fn scan_status(state: State<'_, JobState>, job_id: String) -> Option<ScanJobInfo> {
    let jobs = state.0.lock().unwrap();
    jobs.get(&job_id).cloned()
}

/// 查询某类型文件列表
#[tauri::command]
pub fn list_files(app: tauri::AppHandle, r#type: Option<String>) -> Vec<crate::MediaFile> {
    let db = app.state::<DbState>();
    let conn = db.0.lock().unwrap();
    let mut out = Vec::new();
    let map = |row: &rusqlite::Row| -> rusqlite::Result<crate::MediaFile> {
        Ok(crate::MediaFile {
            id: row.get(0)?,
            path: row.get(1)?,
            r#type: row.get(2)?,
            size: row.get(3)?,
            mtime: row.get(4)?,
            scanned_at: row.get(5)?,
            deleted: row.get(6)?,
        })
    };
    if let Some(t) = &r#type {
        let mut stmt = conn
            .prepare("SELECT id,path,type,size,mtime,scanned_at,deleted FROM files WHERE type=?1 AND deleted=0")
            .unwrap();
        let iter = stmt.query_map(rusqlite::params![t], map).unwrap();
        out.extend(iter.filter_map(|r| r.ok()));
    } else {
        let mut stmt = conn
            .prepare("SELECT id,path,type,size,mtime,scanned_at,deleted FROM files WHERE deleted=0")
            .unwrap();
        let iter = stmt.query_map([], map).unwrap();
        out.extend(iter.filter_map(|r| r.ok()));
    }
    out
}
