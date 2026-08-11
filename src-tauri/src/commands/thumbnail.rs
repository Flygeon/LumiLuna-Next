//! 缩略图：按媒体类型分派，结果落磁盘缓存。
//!
//! - image：image crate 解码 + Lanczos3 缩放，按 EXIF orientation 摆正
//! - audio：取内嵌封面图；没有则回退同目录 cover.jpg/folder.jpg
//! - video：ffmpeg 抽帧（不可用时返回 None，前端显示占位）
//! - book ：epub 取封面图片项
//!
//! 缓存键 = xxh3(file_id + mtime + size)，文件内容变化后自动失效。

use std::io::Read;
use std::path::PathBuf;

use tauri::Manager;

use crate::commands::DbState;
use crate::media::{ext_of, DECODABLE_IMAGE_EXTS};

/// 缓存目录：<app_cache_dir>/thumbs
fn cache_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("thumbs");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn cache_key(file_id: &str, mtime: i64, size: i64, target: u32) -> String {
    let raw = format!("{file_id}:{mtime}:{size}:{target}");
    format!("{:016x}", xxhash_rust::xxh3::xxh3_64(raw.as_bytes()))
}

fn encode_data_url(jpeg: &[u8]) -> String {
    use base64::Engine;
    format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(jpeg)
    )
}

/// 把任意已解码图像缩放并编码为 JPEG 字节
fn to_jpeg(img: image::DynamicImage, target: u32, orientation: Option<i64>) -> Option<Vec<u8>> {
    let img = apply_orientation(img, orientation);
    // thumbnail 内部用 Lanczos3，保持长宽比
    let thumb = img.thumbnail(target, target);
    // JPEG 编码器不接受 alpha 通道
    let rgb = image::DynamicImage::ImageRgb8(thumb.to_rgb8());
    let mut buf = std::io::Cursor::new(Vec::new());
    rgb.write_to(&mut buf, image::ImageFormat::Jpeg).ok()?;
    Some(buf.into_inner())
}

/// 按 EXIF orientation（1..8）摆正图像
fn apply_orientation(img: image::DynamicImage, orientation: Option<i64>) -> image::DynamicImage {
    match orientation.unwrap_or(1) {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img,
    }
}

/// 同目录下常见的封面文件名
const COVER_NAMES: &[&str] = &[
    "cover.jpg", "cover.jpeg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "album.jpg",
];

fn sidecar_cover(path: &str) -> Option<Vec<u8>> {
    let dir = std::path::Path::new(path).parent()?;
    for name in COVER_NAMES {
        let candidate = dir.join(name);
        if candidate.is_file() {
            if let Ok(bytes) = std::fs::read(&candidate) {
                return Some(bytes);
            }
        }
    }
    None
}

/// 从音频标签中取内嵌封面原始字节
pub fn embedded_cover(path: &str) -> Option<Vec<u8>> {
    use lofty::file::TaggedFileExt;
    let tagged = lofty::read_from_path(path).ok()?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag())?;
    let pic = tag.pictures().first()?;
    Some(pic.data().to_vec())
}

/// 从 epub 中取封面图片
fn epub_cover(path: &str) -> Option<Vec<u8>> {
    let file = std::fs::File::open(path).ok()?;
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(file)).ok()?;

    // 找名字里含 cover 的图片项；找不到就用第一张图片
    let mut cover_name: Option<String> = None;
    let mut first_image: Option<String> = None;
    for i in 0..zip.len() {
        let Ok(entry) = zip.by_index(i) else { continue };
        let name = entry.name().to_string();
        let lower = name.to_ascii_lowercase();
        if !(lower.ends_with(".jpg")
            || lower.ends_with(".jpeg")
            || lower.ends_with(".png")
            || lower.ends_with(".webp"))
        {
            continue;
        }
        if first_image.is_none() {
            first_image = Some(name.clone());
        }
        if lower.contains("cover") {
            cover_name = Some(name);
            break;
        }
    }

    let target = cover_name.or(first_image)?;
    let mut entry = zip.by_name(&target).ok()?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).ok()?;
    Some(buf)
}

/// 生成缩略图，返回 JPEG data URL。无法生成时返回 None（前端显示类型占位图）。
#[tauri::command]
pub fn get_thumbnail(
    app: tauri::AppHandle,
    file_id: String,
    size: Option<u32>,
) -> Result<Option<String>, String> {
    let target = size.unwrap_or(320).clamp(64, 1024);

    // 取文件信息（尽早释放数据库锁，解码可能耗时）
    let (path, kind, mtime, fsize, orientation) = {
        let state = app.state::<DbState>();
        let conn = state.0.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT f.path, f.type, f.mtime, f.size, m.orientation
             FROM files f LEFT JOIN media_metadata m ON m.file_id = f.id
             WHERE f.id = ?1",
            rusqlite::params![file_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                ))
            },
        )
        .map_err(|_| format!("文件不存在: {file_id}"))?
    };

    // ---- 磁盘缓存命中 ----
    let cache_file = cache_dir(&app).map(|d| d.join(format!("{}.jpg", cache_key(&file_id, mtime, fsize, target))));
    if let Some(cf) = &cache_file {
        if let Ok(bytes) = std::fs::read(cf) {
            return Ok(Some(encode_data_url(&bytes)));
        }
    }

    // ---- 按类型生成 ----
    let jpeg: Option<Vec<u8>> = match kind.as_str() {
        "image" => {
            let ext = ext_of(std::path::Path::new(&path));
            if DECODABLE_IMAGE_EXTS.contains(&ext.as_str()) {
                image::open(&path)
                    .ok()
                    .and_then(|img| to_jpeg(img, target, orientation))
            } else {
                None
            }
        }
        "audio" => embedded_cover(&path)
            .or_else(|| sidecar_cover(&path))
            .and_then(|bytes| image::load_from_memory(&bytes).ok())
            .and_then(|img| to_jpeg(img, target, None)),
        "video" => {
            // 时长用于避开纯黑开场
            let duration = {
                let state = app.state::<DbState>();
                let conn = state.0.lock().map_err(|e| e.to_string())?;
                conn.query_row(
                    "SELECT duration_ms FROM media_metadata WHERE file_id=?1",
                    rusqlite::params![file_id],
                    |r| r.get::<_, Option<i64>>(0),
                )
                .ok()
                .flatten()
            };
            crate::commands::ffmpeg::extract_frame(&path, target, duration)
        }
        "book" => epub_cover(&path)
            .and_then(|bytes| image::load_from_memory(&bytes).ok())
            .and_then(|img| to_jpeg(img, target, None)),
        _ => None,
    };

    let Some(jpeg) = jpeg else { return Ok(None) };

    if let Some(cf) = &cache_file {
        let _ = std::fs::write(cf, &jpeg);
    }
    Ok(Some(encode_data_url(&jpeg)))
}

/// 清空缩略图磁盘缓存，返回释放的字节数
#[tauri::command]
pub fn clear_thumbnail_cache(app: tauri::AppHandle) -> Result<u64, String> {
    let Some(dir) = cache_dir(&app) else {
        return Ok(0);
    };
    let mut freed = 0u64;
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        if let Ok(md) = entry.metadata() {
            if md.is_file() && std::fs::remove_file(entry.path()).is_ok() {
                freed += md.len();
            }
        }
    }
    Ok(freed)
}
