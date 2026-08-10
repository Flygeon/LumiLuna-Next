pub mod commands;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct MediaFile {
    pub id: String,
    pub path: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub size: i64,
    pub mtime: i64,
    pub scanned_at: i64,
    pub deleted: i64,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct MediaMetadata {
    pub file_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub codec: Option<String>,
    pub fps: Option<f64>,
    pub taken_at: Option<i64>,
    pub camera: Option<String>,
    pub iso: Option<i64>,
    pub gps_lat: Option<f64>,
    pub gps_lng: Option<f64>,
    pub author: Option<String>,
    pub language: Option<String>,
    pub page_count: Option<i64>,
    pub chapter_count: Option<i64>,
}

#[derive(Serialize)]
pub struct Song {
    pub file: MediaFile,
    pub meta: MediaMetadata,
    pub cover_base64: Option<String>,
    pub lyrics: Option<String>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(commands::DbState(std::sync::Mutex::new(open_db())))
        .manage(commands::JobState(std::sync::Mutex::new(
            std::collections::HashMap::new(),
        )))
        .invoke_handler(tauri::generate_handler![
            commands::scan::scan_start,
            commands::scan::scan_cancel,
            commands::scan::scan_status,
            commands::scan::list_files,
            commands::metadata::get_metadata,
            commands::song::get_song,
            commands::thumbnail::get_thumbnail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn open_db() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().expect("open db");
    let _ = commands::init_db(&conn);
    conn
}
