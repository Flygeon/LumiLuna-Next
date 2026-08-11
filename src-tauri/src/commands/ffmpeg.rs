//! FFmpeg 集成：自动探测 PATH、用户手动指定目录、抽帧与探测容器信息。
//!
//! 不打包二进制。找不到 ffmpeg 时所有函数优雅降级（返回 None），
//! 由前端展示占位卡片并引导用户在设置里指定路径或前往下载。

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// 用户在设置中手动指定的 ffmpeg 所在目录（或可执行文件全路径）。
static OVERRIDE_DIR: Mutex<Option<String>> = Mutex::new(None);

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegStatus {
    pub available: bool,
    /// ffmpeg 可执行文件全路径
    pub ffmpeg_path: Option<String>,
    /// ffprobe 可执行文件全路径
    pub ffprobe_path: Option<String>,
    pub version: Option<String>,
    /// "override" = 用户指定；"path" = 系统 PATH；"none" = 未找到
    pub source: String,
}

const EXE_SUFFIX: &str = if cfg!(windows) { ".exe" } else { "" };

/// 在 Windows 上隐藏子进程控制台窗口。
fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// 校验候选路径确实是一个能运行的 ffmpeg/ffprobe。
fn probe_exe(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let out = command(path).arg("-version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    Some(text.lines().next().unwrap_or_default().trim().to_string())
}

/// 在给定目录下寻找 `name`（兼容目录本身就是可执行文件全路径的情况）。
fn find_in_dir(dir: &str, name: &str) -> Option<PathBuf> {
    let base = PathBuf::from(dir);
    let candidates = if base.is_file() {
        // 用户直接选了 ffmpeg.exe：在其所在目录找同伴 ffprobe
        let parent = base.parent()?.to_path_buf();
        vec![parent.join(format!("{name}{EXE_SUFFIX}"))]
    } else {
        vec![
            base.join(format!("{name}{EXE_SUFFIX}")),
            // 官方发行包常见布局 <root>/bin/ffmpeg.exe
            base.join("bin").join(format!("{name}{EXE_SUFFIX}")),
        ]
    };
    candidates.into_iter().find(|p| p.is_file())
}

/// 在 PATH 各条目下寻找 `name`。
fn find_in_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(format!("{name}{EXE_SUFFIX}")))
        .find(|p| p.is_file())
}

/// 解析当前可用的 ffmpeg：优先用户指定目录，其次系统 PATH。
pub fn resolve() -> FfmpegStatus {
    let override_dir = OVERRIDE_DIR.lock().ok().and_then(|g| g.clone());

    if let Some(dir) = override_dir.filter(|d| !d.trim().is_empty()) {
        if let Some(ffmpeg) = find_in_dir(&dir, "ffmpeg") {
            if let Some(version) = probe_exe(&ffmpeg) {
                return FfmpegStatus {
                    available: true,
                    ffmpeg_path: Some(ffmpeg.to_string_lossy().into_owned()),
                    ffprobe_path: find_in_dir(&dir, "ffprobe")
                        .map(|p| p.to_string_lossy().into_owned()),
                    version: Some(version),
                    source: "override".into(),
                };
            }
        }
    }

    if let Some(ffmpeg) = find_in_path("ffmpeg") {
        if let Some(version) = probe_exe(&ffmpeg) {
            return FfmpegStatus {
                available: true,
                ffmpeg_path: Some(ffmpeg.to_string_lossy().into_owned()),
                ffprobe_path: find_in_path("ffprobe").map(|p| p.to_string_lossy().into_owned()),
                version: Some(version),
                source: "path".into(),
            };
        }
    }

    FfmpegStatus {
        source: "none".into(),
        ..Default::default()
    }
}

// ---- ffprobe JSON 结构（只取用得上的字段）----

#[derive(Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    #[serde(default)]
    format: Option<ProbeFormat>,
}

#[derive(Deserialize)]
struct ProbeStream {
    #[serde(default)]
    codec_type: Option<String>,
    #[serde(default)]
    codec_name: Option<String>,
    #[serde(default)]
    width: Option<i64>,
    #[serde(default)]
    height: Option<i64>,
    #[serde(default)]
    avg_frame_rate: Option<String>,
    #[serde(default)]
    sample_rate: Option<String>,
    #[serde(default)]
    channels: Option<i64>,
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    tags: Option<std::collections::HashMap<String, String>>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    #[serde(default)]
    duration: Option<String>,
    #[serde(default)]
    bit_rate: Option<String>,
    #[serde(default)]
    tags: Option<std::collections::HashMap<String, String>>,
}

/// 视频探测结果
#[derive(Default, Clone)]
pub struct VideoInfo {
    pub duration_ms: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub codec: Option<String>,
    pub fps: Option<f64>,
    pub bitrate: Option<i64>,
    pub title: Option<String>,
    pub taken_at: Option<i64>,
}

/// "30000/1001" → 29.97
fn parse_rational(s: &str) -> Option<f64> {
    let (num, den) = s.split_once('/')?;
    let n: f64 = num.trim().parse().ok()?;
    let d: f64 = den.trim().parse().ok()?;
    if d == 0.0 {
        return None;
    }
    Some(n / d)
}

/// 用 ffprobe 读取视频容器信息。ffprobe 不可用时返回 None。
pub fn probe_video(path: &str) -> Option<VideoInfo> {
    let status = resolve();
    let ffprobe = status.ffprobe_path?;

    let out = command(Path::new(&ffprobe))
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            path,
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }

    let parsed: ProbeOutput = serde_json::from_slice(&out.stdout).ok()?;
    let mut info = VideoInfo::default();

    if let Some(format) = &parsed.format {
        info.duration_ms = format
            .duration
            .as_deref()
            .and_then(|d| d.parse::<f64>().ok())
            .map(|s| (s * 1000.0) as i64);
        info.bitrate = format.bit_rate.as_deref().and_then(|b| b.parse().ok());
        if let Some(tags) = &format.tags {
            info.title = tags.get("title").cloned();
            info.taken_at = tags
                .get("creation_time")
                .and_then(|t| parse_iso8601(t));
        }
    }

    let video_stream = parsed
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("video"));
    if let Some(v) = video_stream {
        info.width = v.width;
        info.height = v.height;
        info.codec = v.codec_name.clone();
        info.fps = v.avg_frame_rate.as_deref().and_then(parse_rational);
        if info.duration_ms.is_none() {
            info.duration_ms = v
                .duration
                .as_deref()
                .and_then(|d| d.parse::<f64>().ok())
                .map(|s| (s * 1000.0) as i64);
        }
        if info.taken_at.is_none() {
            info.taken_at = v
                .tags
                .as_ref()
                .and_then(|t| t.get("creation_time"))
                .and_then(|t| parse_iso8601(t));
        }
    }

    Some(info)
}

/// 音频探测（用于 lofty 覆盖不到的格式，如部分 wma/ape）。
pub fn probe_audio(path: &str) -> Option<VideoInfo> {
    let info = probe_video(path)?;
    Some(info)
}

/// "2023-05-01T12:00:00.000000Z" → Unix 秒
fn parse_iso8601(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.timestamp())
}

/// 抽取视频帧并编码为 JPEG 字节。
/// 取 `seek_secs` 处的一帧；对短视频自动回退到第 0 秒。
pub fn extract_frame(path: &str, size: u32, duration_ms: Option<i64>) -> Option<Vec<u8>> {
    let status = resolve();
    let ffmpeg = status.ffmpeg_path?;

    // 取 10% 处的帧，避开纯黑开场；未知时长则取第 1 秒。
    let seek = duration_ms
        .filter(|d| *d > 0)
        .map(|d| (d as f64 / 1000.0 * 0.1).clamp(0.0, 60.0))
        .unwrap_or(1.0);

    for attempt in [seek, 0.0] {
        let out = command(Path::new(&ffmpeg))
            .args([
                "-v",
                "quiet",
                // -ss 放在 -i 前用关键帧快速定位，避免解码整段
                "-ss",
                &format!("{attempt:.3}"),
                "-i",
                path,
                "-frames:v",
                "1",
                "-vf",
                &format!("scale={size}:{size}:force_original_aspect_ratio=decrease"),
                "-f",
                "image2",
                "-c:v",
                "mjpeg",
                "-q:v",
                "4",
                "pipe:1",
            ])
            .output()
            .ok()?;
        if out.status.success() && !out.stdout.is_empty() {
            return Some(out.stdout);
        }
    }
    None
}

// ---- Tauri 命令 ----

/// 查询 ffmpeg 可用状态（设置页展示用）
#[tauri::command]
pub fn ffmpeg_status() -> FfmpegStatus {
    resolve()
}

/// 设置用户手动指定的 ffmpeg 目录；传 None/空串则清除，回落到 PATH 探测。
#[tauri::command]
pub fn ffmpeg_set_path(dir: Option<String>) -> FfmpegStatus {
    if let Ok(mut guard) = OVERRIDE_DIR.lock() {
        *guard = dir.filter(|d| !d.trim().is_empty());
    }
    resolve()
}

/// 官方下载页（前端「获取 FFmpeg」按钮用）
#[tauri::command]
pub fn ffmpeg_download_url() -> String {
    if cfg!(windows) {
        "https://www.gyan.dev/ffmpeg/builds/".into()
    } else if cfg!(target_os = "macos") {
        "https://evermeet.cx/ffmpeg/".into()
    } else {
        "https://ffmpeg.org/download.html".into()
    }
}
