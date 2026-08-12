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
//! 封面接口只接受 URL：这里把内嵌封面（或同目录 cover.jpg）提取出来落到 app cache
//! 下的固定文件 smtc_cover.jpg，再用百分号编码转成 file:/// URI。路径含中文/空格
//! 也能正常解析。

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

/// 推入歌曲元数据（换歌时调用一次）。封面在 Rust 侧从文件提取，前端无需传图。
#[tauri::command]
#[allow(unused_variables)]
pub fn smtc_set_media(
    app: tauri::AppHandle,
    title: String,
    artist: Option<String>,
    album: Option<String>,
    duration_ms: u64,
    file_path: String,
) -> Result<(), String> {
    #[cfg(windows)]
    imp::set_media(&app, &title, artist, album, duration_ms, &file_path);
    Ok(())
}

/// 推入播放状态 + 进度（播放/暂停/拖动时调用，也可由前端节流周期调用）。
#[tauri::command]
#[allow(unused_variables)]
pub fn smtc_set_playback(
    app: tauri::AppHandle,
    playing: bool,
    position_ms: u64,
    duration_ms: u64,
) -> Result<(), String> {
    #[cfg(windows)]
    imp::set_playback(&app, playing, position_ms, duration_ms);
    Ok(())
}

#[cfg(windows)]
mod imp {
    use std::path::Path;
    use std::sync::{Mutex, OnceLock};

    use smtc_tokio::{WindowsMediaEvent, WindowsMediaManager};
    use tauri::{Emitter, Manager};

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
        app: &tauri::AppHandle,
        title: &str,
        artist: Option<String>,
        album: Option<String>,
        duration_ms: u64,
        file_path: &str,
    ) {
        let Some(guard) = inner() else { return };
        let mut g = match guard.lock() {
            Ok(g) => g,
            Err(_) => return,
        };

        let art_url = cover_uri(app, file_path);
        let artists: Vec<String> = artist.iter().cloned().collect();
        let album = album.unwrap_or_default();

        g.manager.set_metadata(title, &artists, &album, duration_ms, art_url.clone());
        g.last_title = title.to_string();
        g.last_artist = artist;
        g.last_album = album;
        g.last_art_url = art_url;
        g.last_duration_ms = duration_ms;
    }

    pub fn set_playback(
        _app: &tauri::AppHandle,
        playing: bool,
        position_ms: u64,
        duration_ms: u64,
    ) {
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

    /// 提取封面字节并落盘，返回 file:/// URI；无封面时返回 None（元数据照常展示）。
    fn cover_uri(app: &tauri::AppHandle, file_path: &str) -> Option<String> {
        let bytes = crate::commands::thumbnail::embedded_cover(file_path)
            .or_else(|| crate::commands::thumbnail::sidecar_cover(file_path))?;
        let dir = app.path().app_cache_dir().ok()?;
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join("smtc_cover.jpg");
        std::fs::write(&path, &bytes).ok()?;
        Some(file_uri(&path))
    }

    /// 本地路径 → file:/// URI。保留 ASCII 字母数字与 `/-_.:@`，其余（中文/空格/保留符）百分号编码。
    fn file_uri(path: &Path) -> String {
        let raw = path.to_string_lossy().replace('\\', "/");
        let mut uri = String::from("file:///");
        for b in raw.bytes() {
            if b.is_ascii_alphanumeric()
                || matches!(b, b'-' | b'_' | b'.' | b'~' | b'/' | b':' | b'@')
            {
                uri.push(b as char);
            } else {
                uri.push_str(&format!("%{b:02X}"));
            }
        }
        uri
    }
}
