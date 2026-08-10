use crate::{MediaFile, MediaMetadata, Song};
use crate::commands::{DbState, metadata};
use tauri::Manager;
use lofty::file::TaggedFileExt;

/// 获取歌曲（音频文件 + 元数据 + 封面 base64 + 内嵌/旁注歌词）
#[tauri::command]
pub fn get_song(app: tauri::AppHandle, file_id: String) -> Option<Song> {
    // 先取文件路径（随后立即释放锁，避免死锁）
    let file: MediaFile = {
        let state = app.state::<DbState>();
        let conn = state.0.lock().unwrap();
        conn.query_row(
            "SELECT id,path,type,size,mtime,scanned_at,deleted FROM files WHERE id=?1",
            rusqlite::params![file_id],
            |row| {
                Ok(MediaFile {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    r#type: row.get(2)?,
                    size: row.get(3)?,
                    mtime: row.get(4)?,
                    scanned_at: row.get(5)?,
                    deleted: row.get(6)?,
                })
            },
        )
        .ok()?
    };

    // 提取元数据
    let meta = metadata::get_metadata(app.clone(), file_id.clone());

    // 封面 + 歌词（lofty）
    let mut cover_base64 = None;
    let mut lyrics = None;
    let ext = std::path::Path::new(&file.path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if ["mp3", "flac", "m4a", "ogg", "wav"].contains(&ext.as_str()) {
        if let Ok(tagged) = lofty::read_from_path(&file.path) {
            if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
                if let Some(pic) = tag.pictures().first() {
                    let mime = pic
                        .mime_type()
                        .map(|m| m.to_string())
                        .unwrap_or_else(|| "image/jpeg".to_string());
                    let b64 = base64::Engine::encode(
                        &base64::engine::general_purpose::STANDARD,
                        pic.data(),
                    );
                    cover_base64 = Some(format!("data:{};base64,{}", mime, b64));
                }
                // 内嵌歌词字段
                if let Some(l) = tag.get_string(&lofty::tag::ItemKey::Lyrics) {
                    lyrics = Some(l.to_string());
                }
            }
        }
        // 旁注 .lrc
        if lyrics.is_none() {
            let lrc_path = file.path.replace(&ext, "lrc");
            if let Ok(content) = std::fs::read_to_string(lrc_path) {
                lyrics = Some(content);
            }
        }
    }

    Some(Song {
        file,
        meta: MediaMetadata {
            file_id: meta.file_id,
            ..meta
        },
        cover_base64,
        lyrics,
    })
}
