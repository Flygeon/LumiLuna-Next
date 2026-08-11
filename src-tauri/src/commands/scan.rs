//! 文件扫描：枚举 → 差分 → 入库 → 后台解析元数据。
//!
//! 设计要点：
//! - 枚举与解析分离，枚举阶段只做 stat，保证大目录也能秒级出列表。
//! - 差分入库：mtime/size 未变的文件跳过重新解析；本次未见到的文件标记 deleted=1。
//! - 取消通过 AtomicBool 传播，扫描循环在每个文件边界检查。
//! - 进度既写入 JobState（供轮询）也 emit 事件（供实时订阅）。

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};
use walkdir::WalkDir;

use crate::commands::{init_db, now_secs, DbState, JobState, ScanJob, ScanJobInfo};
use crate::media::{classify, ext_of};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanConfig {
    pub dirs: Vec<String>,
    #[serde(default)]
    pub max_depth: Option<usize>,
    /// 是否跟随符号链接（默认否，避免成环）
    #[serde(default)]
    pub follow_links: bool,
    /// 强制重新解析所有文件的元数据，忽略 mtime 差分
    #[serde(default)]
    pub force_reparse: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStartResult {
    pub job_id: String,
}

/// 扫描时始终跳过的目录名（系统 / 版本控制 / 依赖）
const SKIP_DIRS: &[&str] = &[
    "$RECYCLE.BIN",
    "System Volume Information",
    "node_modules",
    ".git",
    ".svn",
    "AppData",
    "__pycache__",
    "target",
];

fn xxh3_hex(s: &str) -> String {
    format!("{:016x}", xxhash_rust::xxh3::xxh3_64(s.as_bytes()))
}

fn uuid4() -> String {
    let mut buf = [0u8; 16];
    let _ = getrandom::getrandom(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

/// 枚举阶段产出的一条候选记录
struct Candidate {
    id: String,
    path: String,
    parent: String,
    name: String,
    ext: String,
    kind: &'static str,
    size: i64,
    mtime: i64,
}

/// 启动异步扫描任务，立即返回 jobId
#[tauri::command]
pub fn scan_start(
    app: tauri::AppHandle,
    state: State<'_, JobState>,
    config: ScanConfig,
) -> Result<ScanStartResult, String> {
    if config.dirs.is_empty() {
        return Err("未指定扫描目录".into());
    }

    let job_id = format!("scan-{}", uuid4());
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = state.0.lock().map_err(|e| e.to_string())?;
        jobs.insert(
            job_id.clone(),
            ScanJob {
                info: ScanJobInfo::new(job_id.clone()),
                cancel: cancel.clone(),
            },
        );
    }

    let job_id_ret = job_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if let Err(e) = run_scan(&app, &job_id, config, &cancel) {
            fail_job(&app, &job_id, &e);
        }
    });

    Ok(ScanStartResult { job_id: job_id_ret })
}

fn run_scan(
    app: &tauri::AppHandle,
    job_id: &str,
    config: ScanConfig,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    // ---- 阶段 1：枚举 ----
    set_stage(app, job_id, "enumerate", 0, 0, "");

    let max_depth = config.max_depth.unwrap_or(usize::MAX);
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut seen_paths: HashSet<String> = HashSet::new();

    for dir in &config.dirs {
        let walker = WalkDir::new(dir)
            .max_depth(max_depth)
            .follow_links(config.follow_links)
            .into_iter()
            .filter_entry(|e| {
                if !e.file_type().is_dir() {
                    return true;
                }
                let name = e.file_name().to_string_lossy();
                // 跳过隐藏目录与已知的系统/依赖目录
                !name.starts_with('.') && !SKIP_DIRS.iter().any(|s| s.eq_ignore_ascii_case(&name))
            });

        for entry in walker {
            if cancel.load(Ordering::Relaxed) {
                return finish_cancelled(app, job_id);
            }
            // 单个目录不可读（权限等）不应中断整次扫描
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let ext = ext_of(path);
            let Some(kind) = classify(&ext) else { continue };

            // 一次 stat 拿到 size 与 mtime，避免旧实现的两次系统调用
            let Ok(md) = entry.metadata() else { continue };
            let mtime = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            let path_str = path.to_string_lossy().to_string();
            // 多个扫描目录互相嵌套时会重复枚举同一文件
            if !seen_paths.insert(path_str.clone()) {
                continue;
            }

            candidates.push(Candidate {
                id: xxh3_hex(&path_str),
                parent: path
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default(),
                name: path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default(),
                path: path_str,
                ext,
                kind: kind.as_str(),
                size: md.len() as i64,
                mtime,
            });

            if candidates.len() % 200 == 0 {
                let n = candidates.len();
                let last = candidates[n - 1].path.clone();
                set_stage(app, job_id, "enumerate", n, 0, &last);
            }
        }
    }

    let total = candidates.len();
    set_stage(app, job_id, "store", 0, total, "");

    // ---- 阶段 2：差分入库 ----
    let scanned_at = now_secs();
    let mut added = 0usize;
    let mut updated = 0usize;
    let mut dirty: Vec<(String, String, &'static str)> = Vec::new();
    let removed: usize;

    {
        let db = app.state::<DbState>();
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        init_db(&conn).map_err(|e| e.to_string())?;

        // 载入已知条目用于差分：path -> (mtime, size)
        let existing: std::collections::HashMap<String, (i64, i64)> = {
            let mut stmt = conn
                .prepare("SELECT path, mtime, size FROM files")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))
                .map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };

        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut insert = tx
                .prepare(
                    "INSERT INTO files (id, path, parent, name, ext, type, size, mtime, scanned_at, parsed_at, deleted)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0, 0)
                     ON CONFLICT(id) DO UPDATE SET
                       path=excluded.path, parent=excluded.parent, name=excluded.name,
                       ext=excluded.ext, type=excluded.type, size=excluded.size,
                       mtime=excluded.mtime, scanned_at=excluded.scanned_at, deleted=0",
                )
                .map_err(|e| e.to_string())?;

            for (i, c) in candidates.iter().enumerate() {
                if cancel.load(Ordering::Relaxed) {
                    return finish_cancelled(app, job_id);
                }

                let changed = match existing.get(&c.path) {
                    None => {
                        added += 1;
                        true
                    }
                    Some((old_mtime, old_size)) => {
                        let ch = *old_mtime != c.mtime || *old_size != c.size;
                        if ch {
                            updated += 1;
                        }
                        ch
                    }
                };

                insert
                    .execute(rusqlite::params![
                        c.id, c.path, c.parent, c.name, c.ext, c.kind, c.size, c.mtime, scanned_at
                    ])
                    .map_err(|e| e.to_string())?;

                if changed || config.force_reparse {
                    dirty.push((c.id.clone(), c.path.clone(), c.kind));
                }

                if i % 500 == 0 {
                    let p = c.path.clone();
                    set_stage(app, job_id, "store", i, total, &p);
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;

        // ---- 阶段 3：软删除本次未见到的条目 ----
        removed = conn
            .execute(
                "UPDATE files SET deleted=1 WHERE deleted=0 AND scanned_at < ?1",
                rusqlite::params![scanned_at],
            )
            .map_err(|e| e.to_string())?;
    }

    // ---- 阶段 4：并行解析元数据 ----
    let dirty_total = dirty.len();
    set_stage(app, job_id, "parse", 0, dirty_total, "");

    let done = AtomicUsize::new(0);
    let parsed: Vec<crate::MediaMetadata> = dirty
        .par_iter()
        .filter_map(|(id, path, kind)| {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let meta = crate::commands::metadata::extract(path, id, kind);
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            if n % 25 == 0 || n == dirty_total {
                set_stage(app, job_id, "parse", n, dirty_total, path);
            }
            Some(meta)
        })
        .collect();

    if cancel.load(Ordering::Relaxed) {
        return finish_cancelled(app, job_id);
    }

    // 解析结果批量落库
    {
        let db = app.state::<DbState>();
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        for m in &parsed {
            let _ = crate::commands::metadata::save(&tx, m);
            let _ = tx.execute(
                "UPDATE files SET parsed_at=?1 WHERE id=?2",
                rusqlite::params![scanned_at, m.file_id],
            );
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    // ---- 完成 ----
    let final_info = with_job(app, job_id, |j| {
        j.info.stage = "done".into();
        j.info.done = total;
        j.info.total = total;
        j.info.percent = 100.0;
        j.info.current_path = String::new();
        j.info.added = added;
        j.info.updated = updated;
        j.info.removed = removed;
        j.info.clone()
    });
    if let Some(info) = final_info {
        let _ = app.emit("scan:progress", info);
    }
    Ok(())
}

fn finish_cancelled(app: &tauri::AppHandle, job_id: &str) -> Result<(), String> {
    let info = with_job(app, job_id, |j| {
        j.info.stage = "cancelled".into();
        j.info.clone()
    });
    if let Some(info) = info {
        let _ = app.emit("scan:progress", info);
    }
    Ok(())
}

fn fail_job(app: &tauri::AppHandle, job_id: &str, err: &str) {
    let info = with_job(app, job_id, |j| {
        j.info.stage = "error".into();
        j.info.error = Some(err.to_string());
        j.info.clone()
    });
    if let Some(info) = info {
        let _ = app.emit("scan:progress", info);
    }
}

/// 在锁内修改任务并返回快照；任务已被移除时返回 None。
fn with_job<T>(app: &tauri::AppHandle, job_id: &str, f: impl FnOnce(&mut ScanJob) -> T) -> Option<T> {
    let state = app.state::<JobState>();
    let mut jobs = state.0.lock().ok()?;
    jobs.get_mut(job_id).map(f)
}

fn set_stage(
    app: &tauri::AppHandle,
    job_id: &str,
    stage: &str,
    done: usize,
    total: usize,
    path: &str,
) {
    let info = with_job(app, job_id, |j| {
        j.info.stage = stage.to_string();
        j.info.done = done;
        j.info.total = total;
        j.info.percent = if total > 0 {
            (done as f64 / total as f64) * 100.0
        } else {
            0.0
        };
        j.info.current_path = path.to_string();
        j.info.clone()
    });
    if let Some(info) = info {
        let _ = app.emit("scan:progress", info);
    }
}

/// 取消扫描：置位取消标志，由扫描循环在下一个文件边界响应。
#[tauri::command]
pub fn scan_cancel(state: State<'_, JobState>, job_id: String) {
    if let Ok(jobs) = state.0.lock() {
        if let Some(job) = jobs.get(&job_id) {
            job.cancel.store(true, Ordering::Relaxed);
        }
    }
}

/// 查询扫描状态
#[tauri::command]
pub fn scan_status(state: State<'_, JobState>, job_id: String) -> Option<ScanJobInfo> {
    let jobs = state.0.lock().ok()?;
    jobs.get(&job_id).map(|j| j.info.clone())
}

// ---- 查询 ----

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub search: Option<String>,
    /// name | mtime | size | title | taken_at
    pub sort_by: Option<String>,
    pub desc: Option<bool>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// 查询文件列表（含元数据），支持类型过滤、搜索、排序、分页。
/// 一次 JOIN 取回元数据，替代旧实现的 N 次 get_metadata IPC。
#[tauri::command]
pub fn list_files(
    app: tauri::AppHandle,
    query: Option<ListQuery>,
) -> Result<Vec<crate::MediaEntry>, String> {
    let q = query.unwrap_or_default();
    let db = app.state::<DbState>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut sql = String::from(
        "SELECT f.id, f.path, f.parent, f.name, f.ext, f.type, f.size, f.mtime, f.scanned_at, f.deleted,
                m.title, m.artist, m.album, m.duration_ms, m.width, m.height, m.codec, m.fps,
                m.taken_at, m.has_cover,
                EXISTS(SELECT 1 FROM favorites v WHERE v.file_id = f.id) AS favorite
         FROM files f LEFT JOIN media_metadata m ON m.file_id = f.id
         WHERE f.deleted = 0",
    );
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(t) = q.kind.filter(|t| !t.is_empty()) {
        sql.push_str(" AND f.type = ?");
        params.push(Box::new(t));
    }
    if let Some(s) = q.search.filter(|s| !s.trim().is_empty()) {
        sql.push_str(" AND (f.name LIKE ? OR m.title LIKE ? OR m.artist LIKE ? OR m.album LIKE ?)");
        let like = format!("%{}%", s.trim());
        for _ in 0..4 {
            params.push(Box::new(like.clone()));
        }
    }

    // 白名单排序列，杜绝拼接注入
    let order_col = match q.sort_by.as_deref() {
        Some("mtime") => "f.mtime",
        Some("size") => "f.size",
        Some("title") => "COALESCE(m.title, f.name)",
        Some("taken_at") => "COALESCE(m.taken_at, f.mtime)",
        _ => "f.name",
    };
    sql.push_str(" ORDER BY ");
    sql.push_str(order_col);
    sql.push_str(if q.desc.unwrap_or(false) { " DESC" } else { " ASC" });

    if let Some(limit) = q.limit {
        sql.push_str(" LIMIT ?");
        params.push(Box::new(limit));
        if let Some(offset) = q.offset {
            sql.push_str(" OFFSET ?");
            params.push(Box::new(offset));
        }
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(crate::MediaEntry {
                id: row.get(0)?,
                path: row.get(1)?,
                parent: row.get(2)?,
                name: row.get(3)?,
                ext: row.get(4)?,
                r#type: row.get(5)?,
                size: row.get(6)?,
                mtime: row.get(7)?,
                scanned_at: row.get(8)?,
                deleted: row.get(9)?,
                title: row.get(10)?,
                artist: row.get(11)?,
                album: row.get(12)?,
                duration_ms: row.get(13)?,
                width: row.get(14)?,
                height: row.get(15)?,
                codec: row.get(16)?,
                fps: row.get(17)?,
                taken_at: row.get(18)?,
                has_cover: row.get::<_, Option<i64>>(19)?.unwrap_or(0) != 0,
                favorite: row.get::<_, i64>(20)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|r| r.ok()).collect())
}

/// 各类型数量统计（导航栏角标）
#[tauri::command]
pub fn library_counts(
    app: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, i64>, String> {
    let db = app.state::<DbState>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT type, COUNT(*) FROM files WHERE deleted=0 GROUP BY type")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}
