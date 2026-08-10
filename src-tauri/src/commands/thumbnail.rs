use crate::commands::DbState;
use tauri::Manager;

/// 生成并返回缩略图（图片类：image crate 缩放为 data url）
#[tauri::command]
pub fn get_thumbnail(app: tauri::AppHandle, file_id: String, size: Option<u32>) -> Option<String> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().unwrap();
    let path: String = conn
        .query_row(
            "SELECT path FROM files WHERE id=?1",
            rusqlite::params![file_id],
            |row| row.get(0),
        )
        .ok()?;

    let target = size.unwrap_or(300);
    let ext = std::path::Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let img = match image::open(&path) {
        Ok(img) => img,
        Err(_) => return None,
    };
    let thumb = img.thumbnail(target, target);
    let mut buf = std::io::Cursor::new(Vec::new());
    if thumb.write_to(&mut buf, image::ImageFormat::Jpeg).is_err() {
        return None;
    }
    let b64 = base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        buf.into_inner(),
    );
    let _ = ext;
    Some(format!("data:image/jpeg;base64,{}", b64))
}
