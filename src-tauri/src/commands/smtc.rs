//! Windows 系统媒体控件（SMTC）：把本应用注册为系统媒体会话。
//!
//! 任务栏媒体浮层会显示歌曲信息与封面；媒体键（播放/暂停/上一首/下一首/拖动进度）
//! 通过 `smtc:command` 事件回传前端，由 player store 统一分发。
//!
//! 依赖 `smtc-tokio`：它在隐藏的 STA 线程里创建一个 MediaPlayer 桥接，向 Windows
//! 注册一个属于本应用的 SMTC 会话，并暴露 set_metadata / set_playback_status /
//! set_position 等接口。该依赖只在 Windows 编译（Cargo.toml 里 target 门控），
//! 因此其他平台的命令仍是空操作，前端无需特判平台。
//!
//! # 封面
//! SMTC 的 `RandomAccessStreamReference::CreateFromUri` 不接受 file:// URI，
//! 所以封面一律走 http(s)：
//! - 在线歌曲：直接使用平台返回的 pic URL（http(s)）。
//! - 本地歌曲：提取内嵌封面（或同目录 cover.jpg），归一化成 ≤512px JPEG，
//!   交给一个绑在 127.0.0.1 随机端口的 tiny_http 服务按需提供。
//!   每个版本号 `?v=N` 破坏系统侧缓存，避免换歌后封面残留旧图。

use serde::Serialize;

/// 系统媒体键命令（事件 `smtc:command` 的载荷，与前端 `SmtcCommand` 一一对应）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SmtcCommand {
    pub kind: String,
    pub position_ms: Option<u64>,
}

/// 初始化：Windows 上创建 SMTC 会话并转发按键事件；其他平台为空操作。
pub fn setup(app: &tauri::AppHandle) {
    #[cfg(windows)]
    imp::setup(app);
    #[cfg(not(windows))]
    let _ = app;
}

/// 推入歌曲元数据（换歌时调用一次）。
/// - 本地歌曲：传 file_path，Rust 侧提取封面并提供本地 http 服务。
/// - 在线歌曲：传 cover_url（http(s) 封面直连）。
#[tauri::command]
#[allow(unused_variables)]
pub fn smtc_set_media(
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: u64,
    file_path: String,
    cover_url: Option<String>,
) -> Result<(), String> {
    #[cfg(windows)]
    imp::set_media(&title, artist, album, duration_ms, &file_path, cover_url);
    Ok(())
}

/// 推入播放状态 + 进度（播放/暂停/拖动时调用，也可由前端节流周期调用）。
#[tauri::command]
#[allow(unused_variables)]
pub fn smtc_set_playback(playing: bool, position_ms: u64, duration_ms: u64) -> Result<(), String> {
    #[cfg(windows)]
    imp::set_playback(playing, position_ms, duration_ms);
    Ok(())
}

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};

    use smtc_tokio::{WindowsMediaEvent, WindowsMediaManager};
    use tauri::Emitter;

    use super::SmtcCommand;

    /// 全局单例：SMTC 管理器 + 最近一次元数据。
    /// 真实时长要到音频 loadedmetadata 后才知道；与 set_media 时不一致时，
    /// 用它重发一次元数据以更新时间轴（封面无需重新提取）。
    struct Inner {
        manager: WindowsMediaManager,
        last_title: String,
        last_artist: Option<String>,
        last_album: String,
        last_art_url: Option<String>,
        last_duration_ms: u64,
    }

    static INNER: OnceLock<Mutex<Inner>> = OnceLock::new();

    /// 最近一次本地封面字节（已归一化的 JPEG），tiny_http 线程按需读取
    static COVER_BYTES: Mutex<Vec<u8>> = Mutex::new(Vec::new());
    /// 本地封面服务基址（127.0.0.1 随机端口），首次需要封面时惰性启动
    static COVER_BASE_URL: OnceLock<String> = OnceLock::new();
    /// 封面版本号，追加到 URL 以绕过系统侧缓存
    static COVER_VERSION: AtomicU64 = AtomicU64::new(0);

    fn inner() -> Option<&'static Mutex<Inner>> {
        INNER.get()
    }

    pub fn setup(app: &tauri::AppHandle) {
        let manager = match WindowsMediaManager::new() {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[SMTC] 初始化失败，系统媒体控件不可用: {e}");
                return;
            }
        };
        // 尚未播放时保持 Stopped，避免一个空会话长期占据媒体浮层
        manager.set_stopped();

        // 媒体键 → 前端事件
        if let Some(mut rx) = manager.take_event_rx() {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(ev) = rx.recv().await {
                    let payload = match ev {
                        WindowsMediaEvent::Play => SmtcCommand {
                            kind: "play".into(),
                            position_ms: None,
                        },
                        WindowsMediaEvent::Pause => SmtcCommand {
                            kind: "pause".into(),
                            position_ms: None,
                        },
                        WindowsMediaEvent::Next => SmtcCommand {
                            kind: "next".into(),
                            position_ms: None,
                        },
                        WindowsMediaEvent::Previous => SmtcCommand {
                            kind: "prev".into(),
                            position_ms: None,
                        },
                        WindowsMediaEvent::Stop => SmtcCommand {
                            kind: "stop".into(),
                            position_ms: None,
                        },
                        WindowsMediaEvent::SetPosition(ms) => SmtcCommand {
                            kind: "seek".into(),
                            position_ms: Some(ms),
                        },
                    };
                    let _ = handle.emit("smtc:command", &payload);
                }
            });
        }

        let _ = INNER.set(Mutex::new(Inner {
            manager,
            last_title: String::new(),
            last_artist: None,
            last_album: String::new(),
            last_art_url: None,
            last_duration_ms: 0,
        }));
    }

    pub fn set_media(
        title: &str,
        artist: Option<String>,
        album: Option<String>,
        duration_ms: u64,
        file_path: &str,
        cover_url: Option<String>,
    ) {
        let Some(guard) = inner() else { return };
        let mut g = match guard.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        // 在线歌曲直连 http(s) 封面；本地歌曲提取内嵌封面经本地 http 服务提供
        let art_url = match cover_url.filter(|u| !u.is_empty()) {
            Some(u) => Some(u),
            None => cover_from_file(file_path),
        };
        let artists: Vec<String> = artist.iter().cloned().collect();
        let album = album.unwrap_or_default();

        g.manager.set_metadata(title, &artists, &album, duration_ms, art_url.clone());
        g.last_title = title.to_string();
        g.last_artist = artist;
        g.last_album = album;
        g.last_art_url = art_url;
        g.last_duration_ms = duration_ms;
    }

    pub fn set_playback(playing: bool, position_ms: u64, duration_ms: u64) {
        let Some(guard) = inner() else { return };
        let mut g = match guard.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        // 从未推送过歌曲信息时，保持 Stopped（隐藏空会话）
        if g.last_title.is_empty() && duration_ms == 0 {
            g.manager.set_stopped();
            return;
        }

        // 真实时长在音频加载后才确定；与元数据不一致时重发，更新时间轴
        if duration_ms > 0 && duration_ms != g.last_duration_ms {
            let artists: Vec<String> = g.last_artist.iter().cloned().collect();
            g.manager.set_metadata(
                &g.last_title,
                &artists,
                &g.last_album,
                duration_ms,
                g.last_art_url.clone(),
            );
            g.last_duration_ms = duration_ms;
        }

        g.manager.set_playback_status(playing);
        g.manager.set_position(position_ms);
    }

    /// 从音频文件提取封面并归一化，落进本地服务缓冲，返回带版本的 http:// URL。
    fn cover_from_file(file_path: &str) -> Option<String> {
        let raw = crate::commands::thumbnail::embedded_cover(file_path)
            .or_else(|| crate::commands::thumbnail::sidecar_cover(file_path))?;
        let jpeg = normalize_jpeg(&raw)?;
        *COVER_BYTES.lock().unwrap() = jpeg;
        let ver = COVER_VERSION.fetch_add(1, Ordering::Relaxed) + 1;
        Some(format!("{}/cover.jpg?v={ver}", cover_base_url()))
    }

    fn cover_base_url() -> &'static str {
        COVER_BASE_URL.get_or_init(start_cover_server)
    }

    /// 启动 127.0.0.1 随机端口的单线程 HTTP 服务，每次请求返回当前封面字节。
    fn start_cover_server() -> String {
        let server = match tiny_http::Server::http("127.0.0.1:0") {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[SMTC] 封面本地服务启动失败: {e}");
                return String::new();
            }
        };
        let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
        let srv = std::sync::Arc::new(server);
        let srv2 = srv.clone();
        std::thread::spawn(move || {
            for request in srv2.incoming_requests() {
                let bytes = COVER_BYTES.lock().unwrap().clone();
                let mut resp = tiny_http::Response::from_data(bytes);
                if let Ok(h) = "Content-Type: image/jpeg".parse::<tiny_http::Header>() {
                    resp.add_header(h);
                }
                let _ = request.respond(resp);
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    /// 内嵌封面归一化为 ≤512px 的 JPEG：超大封面（常见于 FLAC）会卡住系统解码。
    fn normalize_jpeg(raw: &[u8]) -> Option<Vec<u8>> {
        let img = image::load_from_memory(raw).ok()?;
        let thumb = img.thumbnail(512, 512);
        let rgb = image::DynamicImage::ImageRgb8(thumb.to_rgb8());
        let mut buf = std::io::Cursor::new(Vec::new());
        rgb.write_to(&mut buf, image::ImageFormat::Jpeg).ok()?;
        Some(buf.into_inner())
    }
}
