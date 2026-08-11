//! 歌曲详情：文件 + 元数据 + 原图封面 + 歌词。
//!
//! 歌词优先级：内嵌 USLT/Lyrics 标签 → 同名 .lrc 旁注文件。
//! .lrc 常见 GBK/Big5 编码，这里做编码嗅探后统一转 UTF-8。

use std::path::Path;

use lofty::file::TaggedFileExt;
use tauri::Manager;

use crate::commands::{metadata, now_secs, DbState};
use crate::{MediaFile, Song};

/// 读取 .lrc 并处理编码：UTF-8 失败时按 GBK → Big5 → Shift_JIS 依次尝试。
fn read_lyrics_file(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;

    // BOM
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8(bytes[3..].to_vec()).ok();
    }
    if let Ok(text) = std::str::from_utf8(&bytes) {
        return Some(text.to_string());
    }

    for encoding in [
        encoding_rs::GBK,
        encoding_rs::BIG5,
        encoding_rs::SHIFT_JIS,
        encoding_rs::EUC_KR,
    ] {
        let (text, _, had_errors) = encoding.decode(&bytes);
        if !had_errors {
            return Some(text.into_owned());
        }
    }
    // 全部失败则用 GBK 有损解码，总比不显示强
    Some(encoding_rs::GBK.decode(&bytes).0.into_owned())
}

/// 获取歌曲完整信息（音频 + 元数据 + 封面 + 歌词）
#[tauri::command]
pub fn get_song(app: tauri::AppHandle, file_id: String) -> Result<Song, String> {
    // 先取文件记录，随即释放锁：后续解码/读盘可能耗时
    let file: MediaFile = {
        let state = app.state::<DbState>();
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id,path,parent,name,ext,type,size,mtime,scanned_at,deleted
             FROM files WHERE id=?1",
            rusqlite::params![file_id],
            |row| {
                Ok(MediaFile {
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
                })
            },
        )
        .map_err(|_| format!("文件不存在: {file_id}"))?
    };

    let meta = metadata::get_metadata(app.clone(), file_id.clone())?;

    let mut cover_base64 = None;
    let mut lyrics = None;

    if file.r#type == "audio" {
        // 封面用原图，播放器要靠它取主色做流体背景
        if let Some(bytes) = crate::commands::thumbnail::embedded_cover(&file.path) {
            let mime = infer_image_mime(&bytes);
            use base64::Engine;
            cover_base64 = Some(format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(&bytes)
            ));
        }

        // 内嵌歌词
        if let Ok(tagged) = lofty::read_from_path(&file.path) {
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                if let Some(l) = tag.get_string(&lofty::prelude::ItemKey::Lyrics) {
                    let trimmed = l.trim();
                    if !trimmed.is_empty() {
                        lyrics = Some(trimmed.to_string());
                    }
                }
            }
        }
        // 旁注 .lrc
        if lyrics.is_none() {
            if let Some(lrc) = metadata::sidecar_lrc_path(&file.path) {
                lyrics = read_lyrics_file(&lrc).filter(|s| !s.trim().is_empty());
            }
        }
    }

    Ok(Song {
        file,
        meta,
        cover_base64,
        lyrics,
    })
}

/// 按魔数判断图片类型，避免依赖标签里可能错误的 mime 字段
fn infer_image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        "image/png"
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF8") {
        "image/gif"
    } else if bytes.len() > 12 && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "image/jpeg"
    }
}

/// 记录一次播放（历史页用）
#[tauri::command]
pub fn record_play(app: tauri::AppHandle, file_id: String) -> Result<(), String> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO history (file_id, played_at) VALUES (?1, ?2)",
        rusqlite::params![file_id, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 收藏 / 取消收藏，返回操作后的状态
#[tauri::command]
pub fn toggle_favorite(app: tauri::AppHandle, file_id: String) -> Result<bool, String> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM favorites WHERE file_id=?1)",
            rusqlite::params![file_id],
            |r| r.get::<_, i64>(0),
        )
        .map_err(|e| e.to_string())?
        != 0;

    if exists {
        conn.execute(
            "DELETE FROM favorites WHERE file_id=?1",
            rusqlite::params![file_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        conn.execute(
            "INSERT INTO favorites (file_id, created_at) VALUES (?1, ?2)",
            rusqlite::params![file_id, now_secs()],
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

/// 收藏列表
#[tauri::command]
pub fn list_favorites(app: tauri::AppHandle) -> Result<Vec<crate::MediaEntry>, String> {
    query_entries(
        app,
        "SELECT f.id, f.path, f.parent, f.name, f.ext, f.type, f.size, f.mtime, f.scanned_at, f.deleted,
                m.title, m.artist, m.album, m.duration_ms, m.width, m.height, m.codec, m.fps,
                m.taken_at, m.has_cover, 1
         FROM favorites v
         JOIN files f ON f.id = v.file_id
         LEFT JOIN media_metadata m ON m.file_id = f.id
         WHERE f.deleted = 0
         ORDER BY v.created_at DESC",
    )
}

/// 最近播放（按文件去重，保留最近一次）
#[tauri::command]
pub fn list_history(app: tauri::AppHandle) -> Result<Vec<crate::MediaEntry>, String> {
    query_entries(
        app,
        "SELECT f.id, f.path, f.parent, f.name, f.ext, f.type, f.size, f.mtime, f.scanned_at, f.deleted,
                m.title, m.artist, m.album, m.duration_ms, m.width, m.height, m.codec, m.fps,
                m.taken_at, m.has_cover,
                EXISTS(SELECT 1 FROM favorites v WHERE v.file_id = f.id)
         FROM (SELECT file_id, MAX(played_at) AS last_played FROM history GROUP BY file_id) h
         JOIN files f ON f.id = h.file_id
         LEFT JOIN media_metadata m ON m.file_id = f.id
         WHERE f.deleted = 0
         ORDER BY h.last_played DESC
         LIMIT 200",
    )
}

/// 已从磁盘消失、被软删除的条目（回收站）
#[tauri::command]
pub fn list_trash(app: tauri::AppHandle) -> Result<Vec<crate::MediaEntry>, String> {
    query_entries(
        app,
        "SELECT f.id, f.path, f.parent, f.name, f.ext, f.type, f.size, f.mtime, f.scanned_at, f.deleted,
                m.title, m.artist, m.album, m.duration_ms, m.width, m.height, m.codec, m.fps,
                m.taken_at, m.has_cover, 0
         FROM files f LEFT JOIN media_metadata m ON m.file_id = f.id
         WHERE f.deleted = 1
         ORDER BY f.scanned_at DESC",
    )
}

/// 清空回收站（仅删索引记录，不动磁盘文件）
#[tauri::command]
pub fn empty_trash(app: tauri::AppHandle) -> Result<usize, String> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM files WHERE deleted=1", [])
        .map_err(|e| e.to_string())
}

/// 共用的 MediaEntry 查询（列顺序必须与 list_files 一致）
fn query_entries(app: tauri::AppHandle, sql: &str) -> Result<Vec<crate::MediaEntry>, String> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
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
