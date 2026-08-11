//! 元数据解析：音频（lofty）、图片（image 头 + kamadak-exif）、视频（ffprobe）、书籍（epub OPF）。
//!
//! `extract` 是纯函数（不碰数据库），因此可在 rayon 线程池里并行调用；
//! 落库由调用方用一个事务批量完成。

use crate::commands::DbState;
use crate::media::{ext_of, DECODABLE_IMAGE_EXTS};
use crate::MediaMetadata;

use lofty::file::{AudioFile, TaggedFileExt};
use lofty::prelude::ItemKey;
use lofty::tag::Accessor;
use tauri::Manager;

/// 解析单个文件的元数据。失败时退化为仅含文件名标题的结构，绝不 panic。
pub fn extract(path: &str, file_id: &str, kind: &str) -> MediaMetadata {
    let mut meta = MediaMetadata {
        file_id: file_id.to_string(),
        ..Default::default()
    };

    // 文件名兜底标题，后续被真实标签覆盖
    meta.title = std::path::Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string());

    match kind {
        "audio" => extract_audio(path, &mut meta),
        "image" => extract_image(path, &mut meta),
        "video" => extract_video(path, &mut meta),
        "book" => extract_book(path, &mut meta),
        _ => {}
    }
    meta
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

// ---- 音频 ----

fn extract_audio(path: &str, meta: &mut MediaMetadata) {
    let Ok(tagged) = lofty::read_from_path(path) else {
        // lofty 不认识的容器（部分 wma/ape）交给 ffprobe
        if let Some(info) = crate::commands::ffmpeg::probe_audio(path) {
            meta.duration_ms = info.duration_ms;
            meta.bitrate = info.bitrate;
            meta.codec = info.codec;
            if let Some(t) = non_empty(info.title) {
                meta.title = Some(t);
            }
        }
        return;
    };

    let props = tagged.properties();
    meta.duration_ms = Some(props.duration().as_millis() as i64);
    meta.bitrate = props.audio_bitrate().map(|b| b as i64);
    meta.sample_rate = props.sample_rate().map(|s| s as i64);
    meta.channels = props.channels().map(|c| c as i64);
    meta.codec = Some(ext_of(std::path::Path::new(path)).to_uppercase());

    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        if let Some(t) = non_empty(tag.title().map(|s| s.to_string())) {
            meta.title = Some(t);
        }
        meta.artist = non_empty(tag.artist().map(|s| s.to_string()));
        meta.album = non_empty(tag.album().map(|s| s.to_string()));
        meta.genre = non_empty(tag.genre().map(|s| s.to_string()));
        meta.year = tag.year().map(|y| y as i64);
        meta.track_no = tag.track().map(|t| t as i64);
        meta.disc_no = tag.disk().map(|d| d as i64);
        meta.album_artist =
            non_empty(tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string()));
        meta.has_cover = !tag.pictures().is_empty();
        meta.has_lyrics = tag.get_string(&ItemKey::Lyrics).is_some();
    }

    // 旁注 .lrc 也算「有歌词」
    if !meta.has_lyrics {
        meta.has_lyrics = sidecar_lrc_path(path).is_some();
    }
}

/// 同名 .lrc 旁注歌词文件（大小写兼容）
pub fn sidecar_lrc_path(path: &str) -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(path);
    for ext in ["lrc", "LRC"] {
        let candidate = p.with_extension(ext);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

// ---- 图片 ----

fn extract_image(path: &str, meta: &mut MediaMetadata) {
    let ext = ext_of(std::path::Path::new(path));
    meta.codec = Some(ext.to_uppercase());

    // 只读文件头拿尺寸，不解码整幅图
    if DECODABLE_IMAGE_EXTS.contains(&ext.as_str()) {
        if let Ok((w, h)) = image::image_dimensions(path) {
            meta.width = Some(w as i64);
            meta.height = Some(h as i64);
        }
    }

    let Ok(file) = std::fs::File::open(path) else { return };
    let mut reader = std::io::BufReader::new(file);
    let Ok(exif) = exif::Reader::new().read_from_container(&mut reader) else {
        return;
    };

    use exif::{In, Tag};
    let get = |tag: Tag| exif.get_field(tag, In::PRIMARY);
    let clean = |f: &exif::Field| {
        f.display_value()
            .to_string()
            .trim_matches('"')
            .trim()
            .to_string()
    };

    if let Some(f) = get(Tag::DateTimeOriginal).or_else(|| get(Tag::DateTime)) {
        meta.taken_at = parse_exif_datetime(&clean(f));
    }
    if let Some(f) = get(Tag::Model) {
        let make = get(Tag::Make).map(clean).unwrap_or_default();
        let model = clean(f);
        // 「Canon Canon EOS R5」这类重复前缀去掉
        meta.camera = Some(if !make.is_empty() && !model.starts_with(&make) {
            format!("{make} {model}")
        } else {
            model
        });
    }
    if let Some(f) = get(Tag::LensModel) {
        meta.lens = non_empty(Some(clean(f)));
    }
    if let Some(f) = get(Tag::PhotographicSensitivity) {
        meta.iso = int_value(&f.value);
    }
    if let Some(f) = get(Tag::ExposureTime) {
        meta.exposure = non_empty(Some(clean(f)));
    }
    if let Some(f) = get(Tag::FNumber) {
        meta.f_number = rational_value(&f.value);
    }
    if let Some(f) = get(Tag::FocalLength) {
        meta.focal_length = rational_value(&f.value);
    }
    if let Some(f) = get(Tag::Orientation) {
        meta.orientation = int_value(&f.value);
    }

    // GPS：度分秒 + 半球参考
    meta.gps_lat = gps_coord(&exif, Tag::GPSLatitude, Tag::GPSLatitudeRef);
    meta.gps_lng = gps_coord(&exif, Tag::GPSLongitude, Tag::GPSLongitudeRef);

    // EXIF 尺寸作为无法解码格式（heic 等）的兜底
    if meta.width.is_none() {
        meta.width = get(Tag::PixelXDimension).and_then(|f| int_value(&f.value));
        meta.height = get(Tag::PixelYDimension).and_then(|f| int_value(&f.value));
    }
}

fn rational_value(v: &exif::Value) -> Option<f64> {
    match v {
        exif::Value::Rational(r) => r.first().map(|x| x.to_f64()),
        exif::Value::SRational(r) => r.first().map(|x| x.to_f64()),
        _ => None,
    }
}

fn int_value(v: &exif::Value) -> Option<i64> {
    match v {
        exif::Value::Short(s) => s.first().map(|x| *x as i64),
        exif::Value::Long(l) => l.first().map(|x| *x as i64),
        _ => None,
    }
}

/// GPS 坐标：三个 rational（度、分、秒）+ N/S/E/W 半球参考
fn gps_coord(exif: &exif::Exif, coord: exif::Tag, refer: exif::Tag) -> Option<f64> {
    use exif::{In, Value};
    let field = exif.get_field(coord, In::PRIMARY)?;
    let Value::Rational(parts) = &field.value else {
        return None;
    };
    if parts.len() < 3 {
        return None;
    }
    let deg = parts[0].to_f64() + parts[1].to_f64() / 60.0 + parts[2].to_f64() / 3600.0;

    let sign = exif
        .get_field(refer, In::PRIMARY)
        .map(|f| f.display_value().to_string().trim().to_uppercase())
        .map(|s| if s.starts_with('S') || s.starts_with('W') { -1.0 } else { 1.0 })
        .unwrap_or(1.0);

    Some(deg * sign)
}

/// EXIF 时间格式 "2023:05:01 12:30:00"（无时区信息，按 UTC 存储）
fn parse_exif_datetime(s: &str) -> Option<i64> {
    let s = s.trim();
    let (date_part, time_part) = s.split_once(' ').unwrap_or((s, "00:00:00"));
    let d: Vec<&str> = date_part.split([':', '-']).collect();
    if d.len() < 3 {
        return None;
    }
    let t: Vec<&str> = time_part.split(':').collect();
    let h = t.first().and_then(|v| v.parse().ok()).unwrap_or(0);
    let mi = t.get(1).and_then(|v| v.parse().ok()).unwrap_or(0);
    let sec = t.get(2).and_then(|v| v.parse().ok()).unwrap_or(0);

    chrono::NaiveDate::from_ymd_opt(d[0].parse().ok()?, d[1].parse().ok()?, d[2].parse().ok()?)?
        .and_hms_opt(h, mi, sec)
        .map(|dt| dt.and_utc().timestamp())
}

// ---- 视频 ----

fn extract_video(path: &str, meta: &mut MediaMetadata) {
    meta.codec = Some(ext_of(std::path::Path::new(path)).to_uppercase());
    // ffprobe 不可用时保留文件名标题，前端显示占位卡片
    let Some(info) = crate::commands::ffmpeg::probe_video(path) else {
        return;
    };
    meta.duration_ms = info.duration_ms;
    meta.width = info.width;
    meta.height = info.height;
    meta.fps = info.fps;
    meta.bitrate = info.bitrate;
    meta.taken_at = info.taken_at;
    if let Some(codec) = info.codec {
        meta.codec = Some(codec.to_uppercase());
    }
    if let Some(title) = non_empty(info.title) {
        meta.title = Some(title);
    }
}

// ---- 书籍 ----

fn extract_book(path: &str, meta: &mut MediaMetadata) {
    let ext = ext_of(std::path::Path::new(path));
    meta.codec = Some(ext.to_uppercase());
    if ext == "epub" {
        extract_epub(path, meta);
    }
}

/// EPUB：读 zip 内的 OPF，取 Dublin Core 元数据。
fn extract_epub(path: &str, meta: &mut MediaMetadata) {
    use std::io::Read;

    let Ok(file) = std::fs::File::open(path) else { return };
    let Ok(mut zip) = zip::ZipArchive::new(std::io::BufReader::new(file)) else {
        return;
    };

    // container.xml 指向真正的 OPF
    let opf_path = (|| {
        let mut container = zip.by_name("META-INF/container.xml").ok()?;
        let mut s = String::new();
        container.read_to_string(&mut s).ok()?;
        let idx = s.find("full-path=")?;
        let rest = &s[idx + "full-path=".len()..];
        let quote = rest.chars().next()?;
        let end = rest[1..].find(quote)?;
        Some(rest[1..1 + end].to_string())
    })();
    let Some(opf_path) = opf_path else { return };

    let opf = (|| {
        let mut f = zip.by_name(&opf_path).ok()?;
        let mut s = String::new();
        f.read_to_string(&mut s).ok()?;
        Some(s)
    })();
    let Some(opf) = opf else { return };

    if let Some(v) = xml_text(&opf, "dc:title") {
        meta.title = Some(v);
    }
    meta.author = xml_text(&opf, "dc:creator");
    meta.publisher = xml_text(&opf, "dc:publisher");
    meta.language = xml_text(&opf, "dc:language");
    // spine 里的 itemref 数量近似章节数
    meta.chapter_count = Some(opf.matches("<itemref").count() as i64);
    meta.has_cover = opf.contains("cover");
}

/// 取 `<tag ...>text</tag>` 的文本内容。EPUB OPF 结构简单，不必引入完整 XML 解析器。
fn xml_text(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let start = xml.find(&open)?;
    let content_start = start + xml[start..].find('>')? + 1;
    let end = xml[content_start..].find(&close)? + content_start;
    let text = xml[content_start..end].trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

// ---- 持久化 ----

pub fn save(conn: &rusqlite::Connection, m: &MediaMetadata) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO media_metadata
         (file_id,title,artist,album_artist,album,genre,year,track_no,disc_no,duration_ms,
          bitrate,sample_rate,channels,width,height,orientation,codec,fps,taken_at,camera,lens,
          iso,exposure,f_number,focal_length,gps_lat,gps_lng,author,publisher,language,
          page_count,chapter_count,has_cover,has_lyrics)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,
                 ?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33,?34)",
        rusqlite::params![
            m.file_id, m.title, m.artist, m.album_artist, m.album, m.genre, m.year,
            m.track_no, m.disc_no, m.duration_ms, m.bitrate, m.sample_rate, m.channels,
            m.width, m.height, m.orientation, m.codec, m.fps, m.taken_at, m.camera, m.lens,
            m.iso, m.exposure, m.f_number, m.focal_length, m.gps_lat, m.gps_lng,
            m.author, m.publisher, m.language, m.page_count, m.chapter_count,
            m.has_cover as i64, m.has_lyrics as i64
        ],
    )?;
    Ok(())
}

fn fetch(conn: &rusqlite::Connection, file_id: &str) -> rusqlite::Result<MediaMetadata> {
    conn.query_row(
        "SELECT file_id,title,artist,album_artist,album,genre,year,track_no,disc_no,duration_ms,
                bitrate,sample_rate,channels,width,height,orientation,codec,fps,taken_at,camera,
                lens,iso,exposure,f_number,focal_length,gps_lat,gps_lng,author,publisher,language,
                page_count,chapter_count,has_cover,has_lyrics
         FROM media_metadata WHERE file_id=?1",
        rusqlite::params![file_id],
        |row| {
            Ok(MediaMetadata {
                file_id: row.get(0)?,
                title: row.get(1)?,
                artist: row.get(2)?,
                album_artist: row.get(3)?,
                album: row.get(4)?,
                genre: row.get(5)?,
                year: row.get(6)?,
                track_no: row.get(7)?,
                disc_no: row.get(8)?,
                duration_ms: row.get(9)?,
                bitrate: row.get(10)?,
                sample_rate: row.get(11)?,
                channels: row.get(12)?,
                width: row.get(13)?,
                height: row.get(14)?,
                orientation: row.get(15)?,
                codec: row.get(16)?,
                fps: row.get(17)?,
                taken_at: row.get(18)?,
                camera: row.get(19)?,
                lens: row.get(20)?,
                iso: row.get(21)?,
                exposure: row.get(22)?,
                f_number: row.get(23)?,
                focal_length: row.get(24)?,
                gps_lat: row.get(25)?,
                gps_lng: row.get(26)?,
                author: row.get(27)?,
                publisher: row.get(28)?,
                language: row.get(29)?,
                page_count: row.get(30)?,
                chapter_count: row.get(31)?,
                has_cover: row.get::<_, i64>(32)? != 0,
                has_lyrics: row.get::<_, i64>(33)? != 0,
            })
        },
    )
}

/// 读取元数据：命中缓存直接返回，否则即时解析并落库。
#[tauri::command]
pub fn get_metadata(app: tauri::AppHandle, file_id: String) -> Result<MediaMetadata, String> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;

    if let Ok(meta) = fetch(&conn, &file_id) {
        return Ok(meta);
    }

    let (path, kind): (String, String) = conn
        .query_row(
            "SELECT path, type FROM files WHERE id=?1",
            rusqlite::params![file_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| format!("文件不存在: {file_id}"))?;

    let meta = extract(&path, &file_id, &kind);
    let _ = save(&conn, &meta);
    Ok(meta)
}
