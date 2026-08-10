use crate::MediaMetadata;
use crate::commands::DbState;
use tauri::Manager;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;

/// 读取媒体元数据
#[tauri::command]
pub fn get_metadata(app: tauri::AppHandle, file_id: String) -> MediaMetadata {
    let state = app.state::<DbState>();
    let conn = state.0.lock().unwrap();

    // 先从库查；缺省时从文件系统提取
    if let Ok(meta) = fetch_from_db(&conn, &file_id) {
        return meta;
    }

    // 从 files 表拿路径
    if let Ok(path) = conn.query_row(
        "SELECT path FROM files WHERE id=?1",
        rusqlite::params![file_id],
        |row| row.get::<_, String>(0),
    ) {
        let meta = extract_from_file(&path, &file_id);
        let _ = save_meta(&conn, &meta);
        return meta;
    }
    MediaMetadata {
        file_id,
        ..Default::default()
    }
}

fn fetch_from_db(conn: &rusqlite::Connection, file_id: &str) -> rusqlite::Result<MediaMetadata> {
    conn.query_row(
        "SELECT file_id,title,artist,album,duration_ms,width,height,codec,fps,
                taken_at,camera,iso,gps_lat,gps_lng,author,language,page_count,chapter_count
         FROM media_metadata WHERE file_id=?1",
        rusqlite::params![file_id],
        |row| {
            Ok(MediaMetadata {
                file_id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album: row.get(3)?,
                duration_ms: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                codec: row.get(7)?,
                fps: row.get(8)?,
                taken_at: row.get(9)?,
                camera: row.get(10)?,
                iso: row.get(11)?,
                gps_lat: row.get(12)?,
                gps_lng: row.get(13)?,
                author: row.get(14)?,
                language: row.get(15)?,
                page_count: row.get(16)?,
                chapter_count: row.get(17)?,
            })
        },
    )
}

fn save_meta(conn: &rusqlite::Connection, m: &MediaMetadata) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO media_metadata
         (file_id,title,artist,album,duration_ms,width,height,codec,fps,taken_at,camera,iso,gps_lat,gps_lng,author,language,page_count,chapter_count)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)",
        rusqlite::params![
            m.file_id, m.title, m.artist, m.album, m.duration_ms,
            m.width, m.height, m.codec, m.fps, m.taken_at, m.camera, m.iso,
            m.gps_lat, m.gps_lng, m.author, m.language, m.page_count, m.chapter_count
        ],
    )?;
    Ok(())
}

/// 按扩展名提取元数据（lofty / kamadak-exif）
fn extract_from_file(path: &str, file_id: &str) -> MediaMetadata {
    let mut meta = MediaMetadata {
        file_id: file_id.to_string(),
        ..Default::default()
    };
    let ext = std::path::Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "mp3" | "flac" | "m4a" | "ogg" | "wav" => {
            if let Ok(tagged) = lofty::read_from_path(path) {
                let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
                if let Some(tag) = tag {
                    meta.title = tag.title().map(|s| s.to_string());
                    meta.artist = tag.artist().map(|s| s.to_string());
                    meta.album = tag.album().map(|s| s.to_string());
                }
                meta.duration_ms = Some(tagged.properties().duration().as_millis() as i64);
            }
        }
        "jpg" | "jpeg" | "png" | "webp" | "heic" => {
            if let Ok(file) = std::fs::File::open(path) {
                if let Ok(exif) = exif::Reader::new().read_from_container(&mut std::io::BufReader::new(file)) {
                    for field in exif.fields() {
                        let name = format!("{:?}", field.tag);
                        let value = field.display_value().to_string();
                        match name.as_str() {
                            "DateTimeOriginal" => {
                                if let Some(ts) = parse_date(&value) {
                                    meta.taken_at = Some(ts);
                                }
                            }
                            "Model" => meta.camera = Some(value),
                            "ISOSpeedRatings" => meta.iso = value.parse().ok(),
                            "GPSLatitude" => meta.gps_lat = parse_gps(&value),
                            "GPSLongitude" => meta.gps_lng = parse_gps(&value),
                            _ => {}
                        }
                    }
                }
            }
        }
        "mp4" | "mov" | "mkv" => {
            // ffprobe 预留：此处留空
        }
        "epub" | "pdf" => {
            // 书籍元数据预留
        }
        _ => {}
    }
    meta
}

fn parse_date(s: &str) -> Option<i64> {
    // 形如 "2023:01:01 12:00:00"
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() < 2 {
        let d: Vec<&str> = s.split(':').collect();
        if d.len() >= 3 {
            let y: i64 = d[0].parse().ok()?;
            let m: i64 = d[1].parse().ok()?;
            let dd: i64 = d[2].parse().ok()?;
            return chrono::NaiveDate::from_ymd_opt(y as i32, m as u32, dd as u32)
                .map(|date| date.and_hms_opt(0, 0, 0).map(|t| t.and_utc().timestamp()).unwrap_or(0));
        }
        None
    } else {
        let date: Vec<&str> = parts[0].split(':').collect();
        let time: Vec<&str> = parts[1].split(':').collect();
        if date.len() >= 3 && time.len() >= 3 {
            let y: i64 = date[0].parse().ok()?;
            let m: i64 = date[1].parse().ok()?;
            let dd: i64 = date[2].parse().ok()?;
            let h: i64 = time[0].parse().ok()?;
            let mi: i64 = time[1].parse().ok()?;
            let sec: i64 = time[2].parse().ok()?;
            return chrono::NaiveDate::from_ymd_opt(y as i32, m as u32, dd as u32)
                .and_then(|date| date.and_hms_opt(h as u32, mi as u32, sec as u32))
                .map(|t| t.and_utc().timestamp());
        }
        None
    }
}

fn parse_gps(s: &str) -> Option<f64> {
    // EXIF GPS 常为 "DDD/1, MM/1, SS/1" 或 "deg min sec"
    let parts: Vec<&str> = s.split(',').collect();
    if parts.len() >= 3 {
        let d: f64 = parts[0].trim().parse().unwrap_or(0.0);
        let m: f64 = parts[1].trim().parse().unwrap_or(0.0);
        let sec: f64 = parts[2].trim().parse().unwrap_or(0.0);
        Some(d + m / 60.0 + sec / 3600.0)
    } else {
        None
    }
}
