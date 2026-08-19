pub mod commands;
pub mod media;
pub mod netease;
pub mod tray;
pub mod webdav;

use serde::{Deserialize, Serialize};
use tauri::Manager;

/// 文件索引记录
#[derive(Serialize, Deserialize, Clone, Default)]
pub struct MediaFile {
    pub id: String,
    pub path: String,
    pub parent: String,
    pub name: String,
    pub ext: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub size: i64,
    pub mtime: i64,
    pub scanned_at: i64,
    pub deleted: i64,
}

/// 媒体元数据。字段以 camelCase 过桥，与前端 TS 类型一一对应。
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaMetadata {
    pub file_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i64>,
    pub track_no: Option<i64>,
    pub disc_no: Option<i64>,
    pub duration_ms: Option<i64>,
    pub bitrate: Option<i64>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub orientation: Option<i64>,
    pub codec: Option<String>,
    pub fps: Option<f64>,
    pub taken_at: Option<i64>,
    pub camera: Option<String>,
    pub lens: Option<String>,
    pub iso: Option<i64>,
    pub exposure: Option<String>,
    pub f_number: Option<f64>,
    pub focal_length: Option<f64>,
    pub gps_lat: Option<f64>,
    pub gps_lng: Option<f64>,
    pub author: Option<String>,
    pub publisher: Option<String>,
    pub language: Option<String>,
    pub page_count: Option<i64>,
    pub chapter_count: Option<i64>,
    pub has_cover: bool,
    pub has_lyrics: bool,
}

/// 列表项：files 与 media_metadata 的扁平化联接结果。
/// 列表页一次拿全展示所需字段，避免逐条再发 get_metadata。
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaEntry {
    pub id: String,
    pub path: String,
    pub parent: String,
    pub name: String,
    pub ext: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub size: i64,
    pub mtime: i64,
    pub scanned_at: i64,
    pub deleted: i64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_ms: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub codec: Option<String>,
    pub fps: Option<f64>,
    pub taken_at: Option<i64>,
    pub has_cover: bool,
    pub favorite: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // 索引库落盘在 app data 目录，重启后保留扫描结果
            let conn = open_db(app.handle())?;
            app.manage(commands::DbState(std::sync::Mutex::new(conn)));
            app.manage(commands::JobState(std::sync::Mutex::new(
                std::collections::HashMap::new(),
            )));
            // Windows 系统媒体控件（SMTC）会话
            commands::smtc::setup(app.handle());
            // 系统托盘（播放控制 / 显示主界面 / 退出）
            if let Err(error) = tray::setup(app.handle()) {
                eprintln!("setup tray failed: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app::exit_app,
            commands::app::open_devtools,
            commands::book::get_book_progress,
            commands::book::save_book_progress,
            commands::scan::scan_start,
            commands::scan::scan_cancel,
            commands::scan::scan_status,
            commands::scan::list_files,
            commands::scan::library_counts,
            commands::metadata::get_metadata,
            commands::song::get_song,
            commands::song::record_play,
            commands::song::toggle_favorite,
            commands::song::list_favorites,
            commands::song::list_history,
            commands::song::list_trash,
            commands::song::empty_trash,
            commands::stats::start_play_session,
            commands::stats::end_play_session,
            commands::stats::get_listen_stats,
            commands::stats::list_listen_stats,
            commands::stats::list_top_tracks,
            commands::stats::listen_source_breakdown,
            commands::smtc::smtc_set_media,
            commands::smtc::smtc_set_playback,
            commands::thumbnail::get_thumbnail,
            commands::thumbnail::thumbnail_cache_path,
            commands::thumbnail::save_thumbnail,
            commands::thumbnail::clear_thumbnail_cache,
            commands::ffmpeg::ffmpeg_status,
            commands::ffmpeg::ffmpeg_set_path,
            commands::ffmpeg::ffmpeg_download_url,
            webdav::webdav_configure,
            webdav::webdav_list,
            webdav::webdav_test,
            webdav::webdav_media_url,
            netease::netease_login_qr_key,
            netease::netease_login_qr_check,
            netease::netease_sms_captcha_sent,
            netease::netease_login_cellphone,
            netease::netease_account,
            netease::netease_user_playlists,
            netease::netease_playlist_detail,
            netease::netease_cloud,
            netease::netease_song_url,
            netease::netease_logout,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 打开磁盘数据库；目录不可用时退回内存库，保证应用仍能启动。
fn open_db(app: &tauri::AppHandle) -> Result<rusqlite::Connection, Box<dyn std::error::Error>> {
    let conn = match app.path().app_data_dir() {
        Ok(dir) => {
            std::fs::create_dir_all(&dir)?;
            rusqlite::Connection::open(dir.join("library.db"))?
        }
        Err(_) => rusqlite::Connection::open_in_memory()?,
    };
    commands::init_db(&conn)?;
    Ok(conn)
}