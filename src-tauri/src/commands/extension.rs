//! 扩展框架（host 侧）。
//!
//! 设计目标：主项目零体积增加，把「锦上添花」的功能（如 MiaoHui 离线内容检索）
//! 作为独立扩展包分发。扩展包放在 `app_data_dir/extensions/<id>/`，含：
//! - `manifest.json`：元数据 + 引擎入口 + 贡献点（窗口/热键/托盘/设置）
//! - `engine/`：扩展私有引擎（MiaoHui 的 Python sidecar）
//! - `web/dist/`：扩展预构建前端（可选，Phase 5 起由前端 ExtensionHost 加载）
//! - `data/`：扩展私有数据（引擎写）
//!
//! 主机只暴露一组**通用桥接命令**（`ext_list`/`ext_install`/`ext_uninstall`/
//! `ext_set_enabled`/`ext_invoke`），把调用路由到扩展引擎的 localhost HTTP。
//! 引擎以 `std::process::Command` 拉起（复用 ffmpeg.rs 的 CREATE_NO_WINDOW），
//! 端口经 stdout 的 `READY <port>` 行握手（复用 webdav.rs 的随机端口思路）。
//!
//! 高权限动作（打开文件/跳秒）由主机代执行，扩展经 `ext_invoke` 请求，
//! 避免扩展直接持有关键权限。

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

// ---- Manifest 结构（camelCase 过桥）----

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub min_host_version: Option<String>,
    #[serde(default)]
    pub engines: Option<ExtEngine>,
    #[serde(default)]
    pub web: Option<ExtWeb>,
    #[serde(default)]
    pub contributes: Option<ExtContributes>,
    #[serde(default)]
    pub permissions: Option<Vec<String>>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtEngine {
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub support_env: Option<String>,
    #[serde(default)]
    pub ready_line: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtWeb {
    #[serde(default)]
    pub dist: Option<String>,
    #[serde(default)]
    pub default_route: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExtContributes {
    #[serde(default)]
    pub windows: Vec<ExtWindowContrib>,
    #[serde(default)]
    pub hotkeys: Vec<ExtHotkey>,
    #[serde(default)]
    pub tray: Vec<ExtTrayItem>,
    #[serde(default)]
    pub settings: Option<ExtSettings>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtWindowContrib {
    pub route: String,
    pub title: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub always_on_top: bool,
    #[serde(default)]
    pub decorations: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtHotkey {
    pub accelerator: String,
    #[serde(default)]
    pub route: String,
    #[serde(default = "default_action")]
    pub action: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtTrayItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub action: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtSettings {
    #[serde(default)]
    pub schema: Vec<Value>,
}

fn default_action() -> String {
    "toggle".to_string()
}

/// 安装来源（前端传）
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtSource {
    pub kind: String, // "folder" | "zip" | "url"
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
}

/// 已安装扩展摘要（前端列表用）
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub has_engine: bool,
    pub engine_ready: bool,
}

// ---- 运行时状态 ----

struct ExtEntry {
    manifest: ExtManifest,
    dir: PathBuf,
    enabled: bool,
    port: Option<u16>,
    child: Option<Child>,
}

#[derive(Default)]
struct ExtState {
    map: Mutex<HashMap<String, ExtEntry>>,
}

// ---- 路径工具 ----

fn ext_base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位 app data 目录：{e}"))?;
    Ok(dir.join("extensions"))
}

fn enabled_state_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位 app data 目录：{e}"))?;
    Ok(dir.join("extensions_state.json"))
}

fn load_enabled_state(app: &tauri::AppHandle) -> HashMap<String, bool> {
    let p = match enabled_state_path(app) {
        Ok(p) => p,
        Err(_) => return HashMap::new(),
    };
    if !p.is_file() {
        return HashMap::new();
    }
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_enabled_state(app: &tauri::AppHandle, map: &HashMap<String, bool>) -> Result<(), String> {
    let p = enabled_state_path(app)?;
    let text = serde_json::to_string(map).map_err(|e| e.to_string())?;
    std::fs::write(&p, text).map_err(|e| e.to_string())
}

/// 在 Windows 上隐藏子进程控制台窗口（同 ffmpeg.rs）
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

// ---- 发现与启动 ----

/// 扫描 extensions/ 目录，填充状态，并（异步）拉起已启用扩展的引擎。
pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    app.manage(ExtState::default());
    if let Err(e) = load_extensions(app) {
        eprintln!("[ext] 加载扩展失败：{e}");
    }
    register_hotkeys(app);
    Ok(())
}

fn load_extensions(app: &tauri::AppHandle) -> Result<(), String> {
    let base = ext_base_dir(app)?;
    let _ = std::fs::create_dir_all(&base);
    let enabled = load_enabled_state(app);

    let mut map: HashMap<String, ExtEntry> = HashMap::new();
    let entries = std::fs::read_dir(&base).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let manifest_path = p.join("manifest.json");
        if !manifest_path.is_file() {
            continue;
        }
        let text = match std::fs::read_to_string(&manifest_path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let manifest: ExtManifest = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[ext] 跳过 {}：manifest 解析失败（{e}）", p.display());
                continue;
            }
        };
        if manifest.id.is_empty() {
            continue;
        }
        let is_enabled = enabled.get(&manifest.id).copied().unwrap_or(true);
        map.insert(
            manifest.id.clone(),
            ExtEntry {
                enabled: is_enabled,
                dir: p,
                manifest,
                port: None,
                child: None,
            },
        );
    }

    let state = app.state::<ExtState>();
    *state.map.lock().unwrap() = map;

    // 异步拉起已启用扩展的引擎，避免阻塞启动
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let ids: Vec<String> = app2
            .state::<ExtState>()
            .map
            .lock()
            .unwrap()
            .values()
            .filter(|e| e.enabled)
            .map(|e| e.manifest.id.clone())
            .collect();
        for id in ids {
            if let Err(e) = spawn_engine(&app2, &id) {
                eprintln!("[ext] 启动引擎 {id} 失败：{e}");
            }
        }
    });
    Ok(())
}

/// 拉起扩展引擎，读取 stdout `READY <port>` 行，存入端口。
fn spawn_engine(app: &tauri::AppHandle, id: &str) -> Result<u16, String> {
    let (dir, cmd, args, support_env) = {
        let map = app.state::<ExtState>().map.lock().unwrap();
        let ext = map.get(id).ok_or_else(|| format!("扩展不存在：{id}"))?;
        let eng = ext
            .manifest
            .engines
            .as_ref()
            .ok_or_else(|| format!("扩展 {id} 没有引擎声明"))?;
        (
            ext.dir.clone(),
            eng.cmd.clone(),
            eng.args.clone(),
            eng.support_env.clone(),
        )
    };

    let mut exe = cmd;
    // 源码模式（cmd 以 .py 结尾）用系统 Python 解释器拉起；冻结模式直接执行。
    let is_py = exe.to_ascii_lowercase().ends_with(".py");
    if !is_py && cfg!(windows) && !exe.to_ascii_lowercase().ends_with(".exe") {
        exe.push_str(".exe");
    }
    let program = dir.join(&exe);
    if !program.is_file() {
        return Err(format!("引擎可执行文件未找到：{}", program.display()));
    }
    let py = if is_py { resolve_python() } else { None };
    if is_py && py.is_none() {
        return Err("未找到可用的 Python 解释器（python/python3/py）".into());
    }
    let data_dir = dir.join("data");
    let _ = std::fs::create_dir_all(&data_dir);

    let mut c = match &py {
        Some(interpreter) => {
            let mut cmd = command(Path::new(interpreter));
            cmd.arg(&program);
            cmd
        }
        None => command(&program),
    };
    c.args(&args).current_dir(&dir).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(env) = &support_env {
        c.env(env, &data_dir);
    }
    let mut child = c.spawn().map_err(|e| format!("启动扩展引擎失败：{e}"))?;

    let port = read_ready_port(child.stdout.take(), Duration::from_secs(20))?;

    let mut map = app.state::<ExtState>().map.lock().unwrap();
    if let Some(ext) = map.get_mut(id) {
        ext.child = Some(child);
        ext.port = Some(port);
    }
    Ok(port)
}

/// 在 PATH 中探测可用的 Python 解释器（源码模式引擎用）。
fn resolve_python() -> Option<String> {
    for p in ["python", "python3", "py"] {
        let ok = command(Path::new(p))
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            return Some(p.to_string());
        }
    }
    None
}

/// 从引擎 stdout 读取首行 `READY <port>`（超时则失败，不阻塞启动）。
fn read_ready_port(
    stdout: Option<impl std::io::Read>,
    timeout: Duration,
) -> Result<u16, String> {
    let mut stdout = stdout.ok_or_else(|| "引擎 stdout 未捕获".to_string())?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut line = String::new();
        let mut reader = BufReader::new(stdout);
        while reader.read_line(&mut line).unwrap_or(0) > 0 {
            let l = line.trim().to_string();
            if l.starts_with("READY") {
                let _ = tx.send(l);
                break;
            }
            line.clear();
        }
    });
    match rx.recv_timeout(timeout) {
        Ok(l) => l
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok())
            .ok_or_else(|| format!("无法解析引擎端口：{l}")),
        Err(_) => Err("等待扩展引擎就绪超时".into()),
    }
}

fn stop_engine(app: &tauri::AppHandle, id: &str) {
    let state = app.state::<ExtState>();
    let mut map = state.map.lock().unwrap();
    if let Some(ext) = map.get_mut(id) {
        if let Some(mut child) = ext.child.take() {
            let _ = child.kill();
        }
        ext.port = None;
    }
}

// ---- Tauri 命令 ----

/// 列出已安装扩展
#[tauri::command]
pub fn ext_list(app: tauri::AppHandle) -> Vec<ExtInfo> {
    let state = app.state::<ExtState>();
    let map = state.map.lock().unwrap();
    map.values()
        .map(|e| ExtInfo {
            id: e.manifest.id.clone(),
            name: e.manifest.name.clone(),
            version: e.manifest.version.clone().unwrap_or_default(),
            enabled: e.enabled,
            has_engine: e.manifest.engines.is_some(),
            engine_ready: e.port.is_some(),
        })
        .collect()
}

/// 安装扩展（folder / zip / url）。校验 manifest 后置入 extensions/<id>/。
#[tauri::command]
pub async fn ext_install(app: tauri::AppHandle, source: ExtSource) -> Result<ExtInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = ext_base_dir(&app)?;
        let _ = std::fs::create_dir_all(&base);
        let staging = base.join("__staging");
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

        match source.kind.as_str() {
            "folder" => {
                let p = source.path.ok_or("缺少路径")?;
                copy_dir(Path::new(&p), &staging)?;
            }
            "zip" => {
                let p = source.path.ok_or("缺少路径")?;
                unzip_to(Path::new(&p), &staging)?;
            }
            "url" => {
                let u = source.url.ok_or("缺少 URL")?;
                let tmp = base.join("__download.zip");
                let _ = std::fs::remove_file(&tmp);
                let resp = reqwest::blocking::Client::new()
                    .get(&u)
                    .timeout(Duration::from_secs(120))
                    .send()
                    .map_err(|e| e.to_string())?;
                let bytes = resp.bytes().map_err(|e| e.to_string())?;
                std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
                unzip_to(&tmp, &staging)?;
                let _ = std::fs::remove_file(&tmp);
            }
            _ => return Err("不支持的安装来源".into()),
        }

        // 校验 manifest
        let manifest_path = staging.join("manifest.json");
        if !manifest_path.is_file() {
            let _ = std::fs::remove_dir_all(&staging);
            return Err("扩展包缺少 manifest.json".into());
        }
        let text = std::fs::read_to_string(&manifest_path).map_err(|e| e.to_string())?;
        let manifest: ExtManifest =
            serde_json::from_str(&text).map_err(|e| format!("manifest 解析失败：{e}"))?;
        if manifest.id.is_empty() {
            return Err("manifest 缺少 id".into());
        }

        let dest = base.join(&manifest.id);
        if dest.exists() {
            std::fs::remove_dir_all(&dest).ok();
        }
        std::fs::rename(&staging, &dest).map_err(|e| e.to_string())?;

        load_extensions(&app)?;

        let state = app.state::<ExtState>();
        let map = state.map.lock().unwrap();
        let ext = map.get(&manifest.id).ok_or("安装后未找到扩展")?;
        Ok(ExtInfo {
            id: ext.manifest.id.clone(),
            name: ext.manifest.name.clone(),
            version: ext.manifest.version.clone().unwrap_or_default(),
            enabled: ext.enabled,
            has_engine: ext.manifest.engines.is_some(),
            engine_ready: ext.port.is_some(),
        })
    })
    .await
    .map_err(|e| format!("安装扩展失败：{e}"))
    .and_then(|r| r)
}

/// 卸载扩展：停引擎 + 删目录
#[tauri::command]
pub async fn ext_uninstall(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        stop_engine(&app, &id);
        let base = ext_base_dir(&app)?;
        let dir = base.join(&id);
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
        app.state::<ExtState>().map.lock().unwrap().remove(&id);
        Ok(())
    })
    .await
    .map_err(|e| format!("卸载扩展失败：{e}"))
    .and_then(|r| r)
}

/// 启用 / 禁用扩展（持久化），并相应拉起 / 停止引擎
#[tauri::command]
pub async fn ext_set_enabled(
    app: tauri::AppHandle,
    id: String,
    enabled: bool,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        {
            let mut map = app.state::<ExtState>().map.lock().unwrap();
            let ext = map.get_mut(&id).ok_or("扩展不存在")?;
            ext.enabled = enabled;
        }
        let mut en = load_enabled_state(&app);
        en.insert(id.clone(), enabled);
        save_enabled_state(&app, &en)?;
        if enabled {
            if let Err(e) = spawn_engine(&app, &id) {
                eprintln!("[ext] 启动引擎失败：{e}");
            }
        } else {
            stop_engine(&app, &id);
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("设置扩展启用状态失败：{e}"))
    .and_then(|r| r)
}

/// 通用路由：把调用转发到扩展引擎的 localhost HTTP。
#[tauri::command]
pub async fn ext_invoke(
    app: tauri::AppHandle,
    id: String,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // 高权限动作由主机代执行（方案书 §1.4）：open/reveal 不转发给引擎
        if method == "open" || method == "reveal" {
            let path = payload
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let ts = payload.get("ts").and_then(|v| v.as_f64());
            let reveal = method == "reveal"
                || payload
                    .get("reveal")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
            return ext_open_impl(&app, &path, ts, reveal)
                .map(|_| json!({ "ok": true }));
        }
        let port = {
            let map = app.state::<ExtState>().map.lock().unwrap();
            map.get(&id).and_then(|e| e.port)
        };
        let port = match port {
            Some(p) => p,
            None => spawn_engine(&app, &id).map_err(|e| format!("扩展引擎未就绪：{e}"))?,
        };
        let url = format!("http://127.0.0.1:{port}/{method}");
        let client = reqwest::blocking::Client::new();
        let resp = client
            .post(&url)
            .json(&payload)
            .timeout(Duration::from_secs(30))
            .send()
            .map_err(|e| format!("调用扩展引擎失败：{e}"))?;
        resp.json::<Value>().map_err(|e| format!("扩展引擎返回非 JSON：{e}"))
    })
    .await
    .map_err(|e| format!("扩展调用异常：{e}"))
    .and_then(|r| r)
}

// ---- 窗口 / 热键 / 托盘（主机代注册）----

/// 打开（或聚焦）扩展窗口。扩展窗口为单一共享窗口 label="extension"，
/// 由前端 ExtensionHost 监听 `ext:navigate` 事件按 ext/route 渲染。
/// 注意：窗口创建必须经 spawn_blocking 脱离主线程，否则与 novel_auth.rs
/// 同款主线程嵌套死锁。
pub fn open_extension_window(
    app: &tauri::AppHandle,
    ext_id: &str,
    route: &str,
) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window("extension") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        let _ = app.emit_to(
            "extension",
            "ext:navigate",
            json!({ "ext": ext_id, "route": route }),
        );
        return Ok(());
    }
    let builder = WebviewWindowBuilder::new(app, "extension", WebviewUrl::App(PathBuf::from("/index.html")))
        .title("LumiLuna · 扩展")
        .inner_size(760.0, 520.0)
        .minimizable(false)
        .resizable(true)
        .decorations(false)
        .always_on_top(true);
    let _win = builder.build(app)?;
    let _ = app.emit_to(
        "extension",
        "ext:navigate",
        json!({ "ext": ext_id, "route": route }),
    );
    Ok(())
}

/// 切换扩展窗口（已可见则关闭）
pub fn toggle_extension_window(
    app: &tauri::AppHandle,
    ext_id: &str,
    route: &str,
) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window("extension") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.close();
            return Ok(());
        }
    }
    open_extension_window(app, ext_id, route)
}

/// 注册所有已启用扩展声明的热键（主机代注册，扩展不直接拿权限）
fn register_hotkeys(app: &tauri::AppHandle) {
    let mut regs: Vec<(String, String, String)> = Vec::new(); // (ext_id, route, accelerator)
    {
        let map = app.state::<ExtState>().map.lock().unwrap();
        for e in map.values() {
            if !e.enabled {
                continue;
            }
            if let Some(c) = &e.manifest.contributes {
                for h in &c.hotkeys {
                    regs.push((e.manifest.id.clone(), h.route.clone(), h.accelerator.clone()));
                }
            }
        }
    }
    for (ext_id, route, accel) in regs {
        let shortcut: Shortcut = match accel.parse() {
            Ok(s) => s,
            Err(_) => {
                eprintln!("[ext] 热键解析失败，跳过：{accel}");
                continue;
            }
        };
        let app2 = app.clone();
        if let Err(err) = app.global_shortcut().register(shortcut, move |a, _sc, ev| {
            if ev.state == ShortcutState::Pressed {
                let app3 = a.clone();
                let ext = ext_id.clone();
                let rt = route.clone();
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = toggle_extension_window(&app3, &ext, &rt);
                });
            }
        }) {
            eprintln!("[ext] 注册热键失败 {accel}：{err}");
        }
    }
}

/// 收集托盘菜单项：(menu_id, title)，menu_id 形如 `ext:<ext_id>:<item_id>`
pub fn tray_menu_items(app: &tauri::AppHandle) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let map = app.state::<ExtState>().map.lock().unwrap();
    for e in map.values() {
        if !e.enabled {
            continue;
        }
        if let Some(c) = &e.manifest.contributes {
            for t in &c.tray {
                out.push((format!("ext:{}:{}", e.manifest.id, t.id), t.title.clone()));
            }
        }
    }
    out
}

/// 处理托盘菜单事件（解析 `ext:<ext_id>:<item_id>`）
pub fn handle_tray_event(app: &tauri::AppHandle, id: &str) {
    let Some(rest) = id.strip_prefix("ext:") else {
        return;
    };
    let Some((ext_id, item_id)) = rest.split_once(':') else {
        return;
    };
    let action = {
        let map = app.state::<ExtState>().map.lock().unwrap();
        map.get(ext_id)
            .and_then(|e| e.manifest.contributes.as_ref())
            .and_then(|c| c.tray.iter().find(|t| t.id == item_id))
            .map(|t| t.action.clone())
    };
    if let Some(action) = action {
        if let Some(route) = action.strip_prefix("open:") {
            let app2 = app.clone();
            let ext = ext_id.to_string();
            let rt = route.to_string();
            tauri::async_runtime::spawn_blocking(move || {
                let _ = open_extension_window(&app2, &ext, &rt);
            });
        } else if let Some(method) = action.strip_prefix("invoke:") {
            let app2 = app.clone();
            let ext = ext_id.to_string();
            let m = method.to_string();
            tauri::async_runtime::spawn(async move {
                let _ = ext_invoke(app2, ext, m, Value::Null).await;
            });
        }
    }
}

// ---- 打开 / 视频跳秒（主机代执行，扩展不直接持有权限）----

const VIDEO_EXTS: &[&str] = &[
    ".mp4", ".mov", ".m4v", ".mkv", ".avi", ".webm", ".flv", ".wmv", ".3gp",
    ".mpg", ".mpeg", ".ts",
];

#[cfg(windows)]
fn player_candidates() -> Vec<PathBuf> {
    let pf = std::env::var("ProgramFiles").unwrap_or_default();
    let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_default();
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    [
        format!(r"{pf}\mpv\mpv.exe"),
        format!(r"{pf86}\mpv\mpv.exe"),
        format!(r"{local}\Programs\mpv\mpv.exe"),
        r"C:\PotPlayer\PotPlayerMini64.exe".to_string(),
        format!(r"{pf}\PotPlayer\PotPlayerMini64.exe"),
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect()
}

#[cfg(not(windows))]
fn player_candidates() -> Vec<PathBuf> {
    // macOS/Linux 常见安装路径
    ["/Applications/mpv.app/Contents/MacOS/mpv", "/usr/bin/mpv", "/usr/local/bin/mpv"]
        .iter()
        .map(PathBuf::from)
        .collect()
}

fn is_video(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    VIDEO_EXTS.iter().any(|e| lower.ends_with(e))
}

/// 打开文件；视频带 ts 时优先 mpv `--start=` / PotPlayer `/seek=`（精确跳秒），
/// 找不到外置播放器则交给系统默认程序。reveal=true 在文件管理器中定位。
fn ext_open_impl(
    app: &tauri::AppHandle,
    path: &str,
    ts: Option<f64>,
    reveal: bool,
) -> Result<(), String> {
    if path.is_empty() {
        return Err("缺少 path".into());
    }
    use tauri_plugin_opener::OpenerExt;
    let opener = app.opener();
    if reveal {
        return opener
            .reveal_item_in_dir(path)
            .map_err(|e| format!("定位文件失败：{e}"));
    }
    if is_video(path) {
        if let Some(ts) = ts {
            for cand in player_candidates() {
                if !cand.is_file() {
                    continue;
                }
                let name = cand.to_string_lossy().to_ascii_lowercase();
                // mpv: --start=<秒> <file>；PotPlayer: <file> /seek=<hhmmss>
                let seek_args: Vec<String> = if name.contains("mpv") {
                    vec![format!("--start={}", ts as i64), path.to_string()]
                } else if name.contains("potplayer") {
                    vec![path.to_string(), format!("/seek={:06}", ts as i64)]
                } else {
                    continue;
                };
                // 播放器需要弹出可见窗口，绝不能带 CREATE_NO_WINDOW
                #[cfg(windows)]
                let mut c = Command::new(&cand);
                #[cfg(not(windows))]
                let mut c = command(&cand);
                c.args(&seek_args);
                if c.spawn().is_ok() {
                    return Ok(());
                }
            }
        }
    }
    opener
        .open_path(path, None::<&str>)
        .map_err(|e| format!("打开文件失败：{e}"))
}

/// 供扩展前端直接调用（也可经 ext_invoke("open") 走主机代执行）。
#[tauri::command]
pub async fn ext_open(
    app: tauri::AppHandle,
    path: String,
    ts: Option<f64>,
    reveal: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ext_open_impl(&app, &path, ts, reveal.unwrap_or(false))
    })
    .await
    .map_err(|e| format!("打开文件异常：{e}"))
    .and_then(|r| r)
}

// ---- 文件工具 ----

fn copy_dir(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for e in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let ft = e.file_type().map_err(|e| e.to_string())?;
        let sp = e.path();
        let dp = dst.join(e.file_name());
        if ft.is_dir() {
            copy_dir(&sp, &dp)?;
        } else if ft.is_file() {
            std::fs::copy(&sp, &dp).map_err(|e| e.to_string())?;
        }
        // 符号链接跳过
    }
    Ok(())
}

fn unzip_to(src: &Path, dst: &Path) -> Result<(), String> {
    let file = std::fs::File::open(src).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    archive.extract(dst).map_err(|e| e.to_string())?;
    Ok(())
}
