//! 在线番剧（Kazumi 规则采集）——桌面端专用（不做 Tauri mobile 适配）。
//!
//! 职责分工（前端做 XPath/JSONPath 求值与状态，这里做 I/O）：
//! - `anime_fetch`：按规则抓取 HTML（UA/Referer/自定义头/Cookie 注入 + 编码嗅探）
//! - `anime_media_url`：防盗链流的本地代理 URL（复用 webdav 的 tiny_http 模式，
//!   m3u8 清单会被改写，分片地址换成代理地址以透传 Referer/Cookie）
//! - `anime_webview_resolve`：隐藏 webview 加载播放页，注入钩子拦截 m3u8/mp4，
//!   轮询 `window.__animeStreams` 回传（静态直链提取的快速路径在前端 animeStream.ts）
//! - 规则 CRUD：`{app_data}/rules/<name>.json`（照 skin 的目录管理模式）
//! - 历史 / 追番：SQLite（v4 迁移，表见 commands/mod.rs）

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::commands::DbState;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0";

const RULES_INDEX_URL: &str =
    "https://raw.githubusercontent.com/Predidit/KazumiRules/main/index.json";

// ---- 响应结构（与前端 @shared/types 对应）----

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimeFetchResult {
    pub html: String,
    pub final_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimeMediaUrlResult {
    pub url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimeRuleEntry {
    pub name: String,
    pub version: Option<String>,
    pub enabled: bool,
    pub json: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimeResolveStream {
    pub url: String,
    pub remote_url: String,
    pub proxied: bool,
    pub method: String,
}

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AnimeHistoryItem {
    pub key: String,
    pub plugin: String,
    pub anime_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub last_episode: Option<String>,
    pub episode_page_url: Option<String>,
    pub detail_url: Option<String>,
    pub road_index: i64,
    pub episode_index: i64,
    pub progress_ms: i64,
    pub duration_ms: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimeFavoriteItem {
    pub plugin: String,
    pub anime_id: String,
    pub title: String,
    pub cover: Option<String>,
    pub added_at: i64,
}

// ---- 请求定义 ----

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnimeFetchSpec {
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub query: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub body_type: String,
    #[serde(default)]
    pub include_cookies: bool,
    #[serde(default)]
    pub referer: Option<String>,
    #[serde(default)]
    pub user_agent: Option<String>,
    /// 单次请求超时（毫秒）；不传用 DEFAULT_FETCH_TIMEOUT_MS。
    /// 聚合搜索同时查几十个源，卡死的站点必须快速失败，否则整轮被拖到分钟级。
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

/// 默认抓取超时（原硬编码 30s，死站会把整轮聚合搜索拖到分钟级）
const DEFAULT_FETCH_TIMEOUT_MS: u64 = 15_000;
/// 建连超时：DNS 不通/被墙的站点应几秒内判死，不必耗满整体超时
const CONNECT_TIMEOUT: Duration = Duration::from_secs(8);

// ---- 运行时状态 ----

/// 规则 cookie 表：rule → host → [(name, value)]。Rust 进程内持有，
/// 仅在 include_cookies 请求 / 媒体代理时注入，前端不可见。
static COOKIE_JARS: OnceLock<Mutex<HashMap<String, HashMap<String, Vec<(String, String)>>>>> =
    OnceLock::new();

/// 媒体代理配置（每次 anime_media_url 调用时按当前规则重建）
#[derive(Clone, Debug)]
struct AnimeProxyConfig {
    headers: Vec<(String, String)>,
}
static PROXY_CONFIG: OnceLock<Mutex<Option<AnimeProxyConfig>>> = OnceLock::new();

/// 取流 webview 的代际号：新一次取流使旧一次失效
static RESOLVE_GEN: AtomicU64 = AtomicU64::new(0);

const WEBVIEW_LABEL: &str = "anime-webview";
const WEBVIEW_TIMEOUT: Duration = Duration::from_secs(30);

fn cookie_jars() -> &'static Mutex<HashMap<String, HashMap<String, Vec<(String, String)>>>> {
    COOKIE_JARS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn proxy_config() -> &'static Mutex<Option<AnimeProxyConfig>> {
    PROXY_CONFIG.get_or_init(|| Mutex::new(None))
}

fn http_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            // 不复用 webdav/novel 的 .no_proxy()：reqwest 0.12 默认 auto_sys_proxy
            // 会读 HTTPS_PROXY/HTTP_PROXY/ALL_PROXY 环境变量 + Windows 系统代理，
            // 在 GFW 环境下直连 raw.githubusercontent.com 会失败（拉不到规则）。
            .connect_timeout(CONNECT_TIMEOUT)
            // 连接复用：同一站点（搜索页 → 详情页 → 播放页）省掉重复的 TLS 握手
            .pool_max_idle_per_host(8)
            .build()
            .expect("anime http client")
    })
}

/// 加入头部时过滤非法头名/值，避免恶意规则让整个请求 build 失败
fn add_header(
    builder: reqwest::blocking::RequestBuilder,
    name: &str,
    value: &str,
) -> reqwest::blocking::RequestBuilder {
    match (
        reqwest::header::HeaderName::try_from(name),
        reqwest::header::HeaderValue::from_str(value),
    ) {
        (Ok(n), Ok(v)) => builder.header(n, v),
        _ => builder,
    }
}

fn b64url(s: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(s.as_bytes())
}

// ---- Cookie 表 ----

fn store_cookie(rule: &str, host: &str, set_cookie: &str) {
    let first = set_cookie.split(';').next().unwrap_or("").trim();
    let Some((name, value)) = first.split_once('=') else {
        return;
    };
    let name = name.trim();
    let value = value.trim();
    if name.is_empty() {
        return;
    }
    let mut jars = cookie_jars().lock().unwrap();
    let rule_map = jars.entry(rule.to_string()).or_default();
    let list = rule_map.entry(host.to_string()).or_default();
    if let Some(existing) = list.iter_mut().find(|(n, _)| n == name) {
        existing.1 = value.to_string();
    } else {
        list.push((name.to_string(), value.to_string()));
    }
}

fn cookie_for_rule(rule: &str, host: &str) -> Option<String> {
    let jars = cookie_jars().lock().ok()?;
    let rule_map = jars.get(rule)?;
    let host_l = host.to_ascii_lowercase();
    let mut parts: Vec<String> = Vec::new();
    for (cookie_host, list) in rule_map {
        let ch = cookie_host.to_ascii_lowercase();
        // 精确 host 或 host 是 cookie_host 的子域
        if host_l == ch || host_l.ends_with(&format!(".{ch}")) {
            for (n, v) in list {
                parts.push(format!("{n}={v}"));
            }
        }
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("; "))
    }
}

// ---- 抓取 ----

fn sniff_charset(content_type: Option<&str>, bytes: &[u8]) -> &'static str {
    // 1. Content-Type charset 参数
    if let Some(ct) = content_type {
        let lower = ct.to_ascii_lowercase();
        if let Some(i) = lower.find("charset=") {
            let cs = lower[i + 8..]
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .trim_matches('"');
            if cs.contains("utf") {
                return "utf-8";
            }
            if cs.contains("gb") || cs.contains("2312") || cs.contains("936") {
                return "gbk";
            }
            if cs.contains("big5") || cs.contains("950") {
                return "big5";
            }
        }
    }
    // 2. HTML meta charset（前 2KB）
    let head = &bytes[..bytes.len().min(2048)];
    if let Ok(s) = std::str::from_utf8(head) {
        let lower = s.to_ascii_lowercase();
        if let Some(i) = lower.find("charset=") {
            let tail = &lower[i + 8..];
            let cs: String = tail
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
                .collect();
            if cs.contains("gb") {
                return "gbk";
            }
            if cs.contains("big5") {
                return "big5";
            }
            if cs.contains("utf") {
                return "utf-8";
            }
        }
    }
    "utf-8"
}

fn decode_bytes(bytes: &[u8], declared: &str) -> String {
    // 严格 UTF-8 优先：GBK 页面含中文时必然不是合法 UTF-8
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    let (gbk_first, big5_first) = if declared == "big5" {
        (false, true)
    } else {
        (true, false)
    };
    if gbk_first {
        let (t, _, had) = encoding_rs::GBK.decode(bytes);
        if !had {
            return t.into_owned();
        }
    }
    if big5_first {
        let (t, _, had) = encoding_rs::BIG5.decode(bytes);
        if !had {
            return t.into_owned();
        }
    }
    let (t, _, _) = encoding_rs::GBK.decode(bytes);
    t.into_owned()
}

/// 通用抓取命令。
///
/// **必须 async + spawn_blocking**：Tauri v2 的同步 `#[tauri::command]` 跑在主线程，
/// 而 `reqwest::blocking` 会把整条线程占满到响应结束。聚合搜索同时打几十个源时，
/// 所有请求在主线程上串行排队，界面整段卡死（表现为「检索特别慢 / 经常无响应」）。
/// 挪到 tokio 阻塞线程池后请求真正并发，主线程立刻回到事件循环。
#[tauri::command]
pub async fn anime_fetch(
    rule_name: String,
    spec: AnimeFetchSpec,
) -> Result<AnimeFetchResult, String> {
    tokio::task::spawn_blocking(move || anime_fetch_blocking(rule_name, spec))
        .await
        .map_err(|e| format!("抓取任务异常退出：{e}"))?
}

/// 真正干活的阻塞抓取（只应在 spawn_blocking 里调用）
fn anime_fetch_blocking(
    rule_name: String,
    spec: AnimeFetchSpec,
) -> Result<AnimeFetchResult, String> {
    let client = http_client();
    let mut url = spec.url.clone();
    if !spec.query.is_empty() {
        let params: Vec<String> = spec
            .query
            .iter()
            .map(|(k, v)| format!("{}={}", urlencode(k), urlencode(v)))
            .collect();
        url = format!("{url}?{}", params.join("&"));
    }
    // 先校验 URL：url crate 对空串/相对地址/非 ASCII 会直接拒绝，reqwest 把这类
    // 解析失败统一 Display 成 "builder error"，对用户毫无信息量。提前解析并把
    // 可读原因抛给前端（Kazumi 同样在发请求前校验 URL）。
    let parsed = match url::Url::parse(&url) {
        Ok(u) => u,
        Err(e) => {
            return Err(format!(
                "请求 URL 无效（规则 {rule_name}）：{url}\n{e}\n请检查规则里 URL 是否为空、缺少协议（http/https）或含非法字符"
            ))
        }
    };
    let mut req = match spec.method.as_str() {
        "POST" => client.post(&url),
        _ => client.get(&url),
    };
    // Referer 默认 baseURL + "/"（Kazumi 同款），前端已在 spec 里显式带上
    let referer = spec
        .referer
        .as_deref()
        .filter(|r| !r.is_empty())
        .map(|r| r.to_owned())
        .or_else(|| Some(format!("{}/", parsed.origin().ascii_serialization())));
    if let Some(r) = referer {
        req = add_header(req, "referer", &r);
    }
    let ua = spec
        .user_agent
        .as_deref()
        .filter(|u| !u.is_empty())
        .unwrap_or(UA);
    req = add_header(req, "user-agent", ua);
    if spec.include_cookies {
        if let Some(host) = parsed.host_str() {
            if let Some(c) = cookie_for_rule(&rule_name, host) {
                req = add_header(req, "cookie", &c);
            }
        }
    }
    for (k, v) in &spec.headers {
        req = add_header(req, k, v);
    }
    if spec.method == "POST" {
        if let Some(body) = &spec.body {
            req = req.body(body.clone());
            match spec.body_type.as_str() {
                "form" => {
                    req = add_header(req, "content-type", "application/x-www-form-urlencoded")
                }
                "json" => req = add_header(req, "content-type", "application/json"),
                _ => {}
            }
        }
    }

    let timeout = Duration::from_millis(
        spec.timeout_ms
            .unwrap_or(DEFAULT_FETCH_TIMEOUT_MS)
            .clamp(1_000, 60_000),
    );
    let resp = req.timeout(timeout).send().map_err(|e| {
        // 把 reqwest 的笼统错误分类成可读中文（builder/连接/超时……）
        let kind = if e.is_timeout() {
            "超时"
        } else if e.is_connect() {
            "连接失败"
        } else if e.is_builder() {
            "URL 无效"
        } else if e.is_redirect() {
            "重定向异常"
        } else if e.is_body() {
            "请求体错误"
        } else if e.is_decode() {
            "响应解码失败"
        } else {
            "未知错误"
        };
        format!("网络请求失败（{kind}）：{e}\n（规则 {rule_name} · {url}）")
    })?;
    let status = resp.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(format!("HTTP {status}（规则 {rule_name} · {url}）"));
    }
    let final_url = resp.url().as_str().to_string();
    let request_host = parsed.host_str().unwrap_or_default().to_string();
    for set_cookie in resp.headers().get_all("set-cookie") {
        if let Ok(s) = set_cookie.to_str() {
            store_cookie(&rule_name, &request_host, s);
        }
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let bytes = resp.bytes().map_err(|e| format!("读取响应失败：{e}"))?;
    let declared = sniff_charset(content_type.as_deref(), &bytes);
    let html = decode_bytes(&bytes, declared);
    Ok(AnimeFetchResult {
        html,
        final_url: Some(final_url),
    })
}

fn urlencode(s: &str) -> String {
    // 与表单/query 编码一致：空格 → %20
    let mut out = String::new();
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

// ---- 规则 CRUD ----

fn rules_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位应用数据目录：{e}"))?;
    Ok(dir.join("rules"))
}

fn sanitize_rule_name(name: &str) -> String {
    let out: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "rule".to_string()
    } else {
        trimmed.chars().take(60).collect()
    }
}

fn load_rule(app: &tauri::AppHandle, name: &str) -> Result<serde_json::Value, String> {
    let dir = rules_dir(app)?;
    let path = dir.join(format!("{}.json", sanitize_rule_name(name)));
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("找不到规则 {name}：{e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("规则 {name} 解析失败：{e}"))
}

fn extract_meta(raw: &str) -> (String, Option<String>) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        let name = v
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string();
        let version = v
            .get("version")
            .and_then(|n| n.as_str())
            .map(|s| s.to_string());
        return (name, version);
    }
    (String::new(), None)
}

#[tauri::command]
pub fn anime_rules_list(app: tauri::AppHandle) -> Result<Vec<AnimeRuleEntry>, String> {
    let dir = rules_dir(&app)?;
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let path = entry.path();
            if path.extension().map(|x| x == "json").unwrap_or(false) {
                if let Ok(raw) = std::fs::read_to_string(&path) {
                    let (name, version) = extract_meta(&raw);
                    if !name.is_empty() {
                        out.push(AnimeRuleEntry {
                            name,
                            version,
                            enabled: true,
                            json: raw,
                        });
                    }
                }
            }
        }
    }
    Ok(out)
}

/// 保存规则（同 name 覆盖，原子替换）；json 为前端 normalizeRule 后的文档
#[tauri::command]
pub fn anime_rules_save(app: tauri::AppHandle, name: String, json: String) -> Result<(), String> {
    let dir = rules_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.json", sanitize_rule_name(&name)));
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| format!("写入规则失败：{e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存规则失败：{e}"))?;
    Ok(())
}

#[tauri::command]
pub fn anime_rules_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let dir = rules_dir(&app)?;
    let path = dir.join(format!("{}.json", sanitize_rule_name(&name)));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("删除规则失败：{e}"))?;
    }
    Ok(())
}

/// 拉取 KazumiRules 社区仓库 index（Phase 1 仅展示，不自动安装）
/// 同 anime_fetch：阻塞 I/O 走 spawn_blocking，避免同步命令冻结主线程。
#[tauri::command]
pub async fn anime_rules_index() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let resp = http_client()
            .get(RULES_INDEX_URL)
            .timeout(Duration::from_secs(15))
            .send()
            .map_err(|e| {
                format!(
                    "拉取规则仓库失败：{e}\n（raw.githubusercontent.com 部分地区被墙，请确认系统/环境代理可用）"
                )
            })?;
        if !resp.status().is_success() {
            return Err(format!("规则仓库返回 HTTP {}", resp.status().as_u16()));
        }
        resp.text().map_err(|e| format!("读取规则仓库失败：{e}"))
    })
    .await
    .map_err(|e| format!("规则仓库任务异常退出：{e}"))?
}

// ---- 历史 / 追番（SQLite v4）----

fn map_history_row(r: &rusqlite::Row) -> rusqlite::Result<AnimeHistoryItem> {
    Ok(AnimeHistoryItem {
        key: r.get(0)?,
        plugin: r.get(1)?,
        anime_id: r.get(2)?,
        title: r.get(3)?,
        cover: r.get(4)?,
        last_episode: r.get(5)?,
        episode_page_url: r.get(6)?,
        detail_url: r.get(7)?,
        road_index: r.get(8)?,
        episode_index: r.get(9)?,
        progress_ms: r.get(10)?,
        duration_ms: r.get(11)?,
        updated_at: r.get(12)?,
    })
}

#[tauri::command]
pub fn anime_history_list(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<AnimeHistoryItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT key, plugin, anime_id, title, cover, last_episode, episode_page_url, \
             detail_url, road_index, episode_index, progress_ms, duration_ms, updated_at \
             FROM anime_history ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], map_history_row)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn anime_history_upsert(
    state: tauri::State<'_, DbState>,
    item: AnimeHistoryItem,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO anime_history \
         (key, plugin, anime_id, title, cover, last_episode, episode_page_url, detail_url, \
          road_index, episode_index, progress_ms, duration_ms, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) \
         ON CONFLICT(key) DO UPDATE SET \
         plugin=excluded.plugin, anime_id=excluded.anime_id, title=excluded.title, \
         cover=excluded.cover, last_episode=excluded.last_episode, \
         episode_page_url=excluded.episode_page_url, detail_url=excluded.detail_url, \
         road_index=excluded.road_index, episode_index=excluded.episode_index, \
         progress_ms=excluded.progress_ms, duration_ms=excluded.duration_ms, \
         updated_at=excluded.updated_at",
        rusqlite::params![
            item.key,
            item.plugin,
            item.anime_id,
            item.title,
            item.cover,
            item.last_episode,
            item.episode_page_url,
            item.detail_url,
            item.road_index,
            item.episode_index,
            item.progress_ms,
            item.duration_ms,
            item.updated_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn anime_history_delete(state: tauri::State<'_, DbState>, key: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM anime_history WHERE key = ?1", [key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn anime_favorites_list(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<AnimeFavoriteItem>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT plugin, anime_id, title, cover, added_at \
             FROM anime_favorites ORDER BY added_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AnimeFavoriteItem {
                plugin: r.get(0)?,
                anime_id: r.get(1)?,
                title: r.get(2)?,
                cover: r.get(3)?,
                added_at: r.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn anime_favorites_add(
    state: tauri::State<'_, DbState>,
    plugin: String,
    anime_id: String,
    title: String,
    cover: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO anime_favorites (plugin, anime_id, title, cover, added_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) \
         ON CONFLICT(plugin, anime_id) DO UPDATE SET title=excluded.title, cover=excluded.cover",
        rusqlite::params![plugin, anime_id, title, cover, crate::commands::now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn anime_favorites_remove(
    state: tauri::State<'_, DbState>,
    plugin: String,
    anime_id: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM anime_favorites WHERE plugin = ?1 AND anime_id = ?2",
        rusqlite::params![plugin, anime_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- 媒体代理 ----

static PROXY_BASE: OnceLock<String> = OnceLock::new();

fn anime_proxy_base() -> Option<String> {
    if let Some(b) = PROXY_BASE.get() {
        return Some(b.clone());
    }
    let server = tiny_http::Server::http("127.0.0.1:0").ok()?;
    let port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(0);
    let srv = std::sync::Arc::new(server);
    let srv2 = srv.clone();
    std::thread::spawn(move || {
        for request in srv2.incoming_requests() {
            std::thread::spawn(move || {
                if let Err(e) = handle_anime_proxy(request) {
                    eprintln!("[anime] 代理请求失败: {e}");
                }
            });
        }
    });
    let base = format!("http://127.0.0.1:{port}");
    let _ = PROXY_BASE.set(base.clone());
    Some(base)
}

fn proxy_header(name: &str, value: &str) -> Option<tiny_http::Header> {
    format!("{name}: {value}").parse().ok()
}

fn respond_text(
    request: tiny_http::Request,
    status: tiny_http::StatusCode,
    text: String,
) -> Result<(), String> {
    let len = text.len();
    let mut headers = vec![proxy_header("Access-Control-Allow-Origin", "*").unwrap()];
    if let Some(h) = proxy_header("Content-Type", "text/plain; charset=utf-8") {
        headers.push(h);
    }
    let body = std::io::Cursor::new(text.into_bytes());
    let response = tiny_http::Response::new(status, headers, body, Some(len), None);
    request.respond(response).map_err(|e| e.to_string())
}

fn is_loopback_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost")
        || host == "127.0.0.1"
        || host == "::1"
        || host == "[::1]"
}

/// 生成媒体访问的本地代理 URL（携带规则 Referer/UA/自定义头/Cookie）
#[tauri::command]
pub fn anime_media_url(
    app: tauri::AppHandle,
    rule_name: String,
    url: String,
) -> Result<AnimeMediaUrlResult, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "媒体 URL 无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("仅支持 http/https 媒体".into());
    }
    let headers = build_media_headers(&app, &rule_name, &parsed)?;
    *proxy_config().lock().map_err(|e| e.to_string())? = Some(AnimeProxyConfig { headers });
    let base = anime_proxy_base().ok_or_else(|| "媒体代理启动失败".to_string())?;
    let encoded = b64url(&url);
    Ok(AnimeMediaUrlResult {
        url: format!("{base}/anime?u={encoded}"),
    })
}

fn build_media_headers(
    app: &tauri::AppHandle,
    rule_name: &str,
    media: &url::Url,
) -> Result<Vec<(String, String)>, String> {
    let rule = load_rule(app, rule_name)?;
    let mut headers: Vec<(String, String)> = Vec::new();
    let base = rule.get("baseURL").and_then(|v| v.as_str()).unwrap_or("");
    let referer = rule
        .get("referer")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| {
            if !base.is_empty() {
                format!("{}/", base.trim_end_matches('/'))
            } else {
                format!("{}/", media.origin().ascii_serialization())
            }
        });
    headers.push(("referer".into(), referer));
    let ua = rule
        .get("userAgent")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(UA);
    headers.push(("user-agent".into(), ua.to_string()));
    if let Some(h) = rule.get("httpHeaders").and_then(|v| v.as_object()) {
        for (k, v) in h {
            if let Some(s) = v.as_str() {
                headers.push((k.to_lowercase(), s.to_string()));
            }
        }
    }
    if let Some(host) = media.host_str() {
        if let Some(c) = cookie_for_rule(rule_name, host) {
            headers.push(("cookie".into(), c));
        }
    }
    Ok(headers)
}

/// m3u8 清单改写：分片 / AES Key 的 URI 换成代理地址，透传 Referer/Cookie
fn proxy_url_for(url: &str, proxy_base: &str) -> String {
    format!("{proxy_base}/anime?u={}", b64url(url))
}

fn resolve_segment(uri: &str, base: &str) -> String {
    url::Url::parse(uri)
        .or_else(|_| url::Url::parse(base).and_then(|b| b.join(uri)))
        .map(|u| u.to_string())
        .unwrap_or_else(|_| uri.to_string())
}

fn rewrite_m3u8(text: &str, manifest_url: &str, proxy_base: &str) -> String {
    let mut out = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            if trimmed.starts_with("#EXT-X-KEY") && trimmed.contains("URI=") {
                out.push_str(&rewrite_key_uri(trimmed, manifest_url, proxy_base));
            } else {
                out.push_str(line);
            }
            out.push('\n');
            continue;
        }
        let abs = resolve_segment(trimmed, manifest_url);
        out.push_str(&proxy_url_for(&abs, proxy_base));
        out.push('\n');
    }
    out
}

fn rewrite_key_uri(line: &str, manifest_url: &str, proxy_base: &str) -> String {
    for quote in ['"', '\''] {
        if let Some(i) = line.find("URI=") {
            let rest = &line[i + 4..];
            if let Some(rest) = rest.strip_prefix(quote) {
                if let Some(close) = rest.find(quote) {
                    let uri = &rest[..close];
                    let abs = resolve_segment(uri, manifest_url);
                    let proxied = proxy_url_for(&abs, proxy_base);
                    return format!(
                        "{}{quote}{proxied}{quote}{}",
                        &line[..i + 4],
                        &rest[close + 1..]
                    );
                }
            }
        }
    }
    line.to_string()
}

fn is_m3u8_path(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".m3u8")
}

fn handle_anime_proxy(request: tiny_http::Request) -> Result<(), String> {
    if !matches!(request.method(), tiny_http::Method::Get) {
        return respond_text(
            request,
            tiny_http::StatusCode(405),
            "method not allowed".into(),
        );
    }
    let (path, query) = match request.url().split_once('?') {
        Some((p, q)) => (p, q),
        None => (request.url(), ""),
    };
    if path != "/anime" {
        return respond_text(request, tiny_http::StatusCode(404), "not found".into());
    }
    let Some(remote) = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("u="))
        .and_then(|u| {
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(u)
                .ok()
        })
        .and_then(|bytes| String::from_utf8(bytes).ok())
    else {
        return respond_text(request, tiny_http::StatusCode(400), "bad request".into());
    };
    let remote_parsed = match url::Url::parse(&remote) {
        Ok(u) if matches!(u.scheme(), "http" | "https") => u,
        _ => return respond_text(request, tiny_http::StatusCode(400), "bad url".into()),
    };
    // 防跳板：只禁本机回环，允许 CDN 等任意远端 host（m3u8 分片常来自不同域名）
    if remote_parsed
        .host_str()
        .map(is_loopback_host)
        .unwrap_or(true)
    {
        return respond_text(request, tiny_http::StatusCode(403), "forbidden".into());
    }
    let cfg = proxy_config()
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "媒体代理未配置".to_string())?;

    let mut builder = http_client().get(&remote);
    for (k, v) in &cfg.headers {
        builder = add_header(builder, k, v);
    }
    // Range 只透传给普通媒体流；m3u8 清单直接取全量再改写
    let range = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        .map(|h| h.value.as_str().to_string());
    if is_m3u8_path(remote_parsed.path()) {
        let resp = builder
            .send()
            .map_err(|e| format!("代理请求远端失败：{e}"))?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let text = resp.text().unwrap_or_default();
            return respond_text(request, tiny_http::StatusCode::from(status), text);
        }
        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        let is_manifest = content_type.contains("mpegurl")
            || (is_m3u8_path(remote_parsed.path()) && !content_type.contains("text/html"));
        if is_manifest {
            let text = resp.text().map_err(|e| format!("读取 m3u8 失败：{e}"))?;
            let base = anime_proxy_base().ok_or_else(|| "媒体代理未就绪".to_string())?;
            let rewritten = rewrite_m3u8(&text, &remote, &base);
            let len = rewritten.len();
            let headers = vec![
                proxy_header("Content-Type", "application/vnd.apple.mpegurl").unwrap(),
                proxy_header("Access-Control-Allow-Origin", "*").unwrap(),
                proxy_header("Cache-Control", "no-store").unwrap(),
            ];
            if let Some(r) = range {
                // 玩家通常对清单发完整请求；若带 Range 则原样回 200 全量
                let _ = r;
            }
            let body = std::io::Cursor::new(rewritten.into_bytes());
            let response = tiny_http::Response::new(
                tiny_http::StatusCode(200),
                headers,
                body,
                Some(len),
                None,
            );
            return request.respond(response).map_err(|e| e.to_string());
        }
        // 路径像 m3u8 但不是清单（可能被重定向/拦截）——按普通流透传
        return stream_media(request, resp, range);
    }

    if let Some(r) = range {
        builder = add_header(builder, "Range", &r);
    }
    let resp = builder
        .send()
        .map_err(|e| format!("代理请求远端失败：{e}"))?;
    stream_media(request, resp, None)
}

fn stream_media(
    request: tiny_http::Request,
    resp: reqwest::blocking::Response,
    range: Option<String>,
) -> Result<(), String> {
    if !resp.status().is_success() && resp.status().as_u16() != 206 {
        let status = resp.status().as_u16();
        let text = resp.text().unwrap_or_default();
        return respond_text(request, tiny_http::StatusCode::from(status), text);
    }
    let mut headers = Vec::new();
    if let Some(ct) = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
    {
        if let Some(h) = proxy_header("Content-Type", ct) {
            headers.push(h);
        }
    }
    if let Some(cr) = resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
    {
        if let Some(h) = proxy_header("Content-Range", cr) {
            headers.push(h);
        }
    }
    if let Some(h) = proxy_header("Accept-Ranges", "bytes") {
        headers.push(h);
    }
    if let Some(h) = proxy_header("Access-Control-Allow-Origin", "*") {
        headers.push(h);
    }
    if let Some(h) = proxy_header(
        "Access-Control-Expose-Headers",
        "Content-Range, Content-Length, Accept-Ranges",
    ) {
        headers.push(h);
    }
    if let Some(r) = range {
        if let Some(h) = proxy_header("Content-Range-Passthrough", &r) {
            let _ = h; // 标记：Range 已在请求时带上
        }
    }
    let status = tiny_http::StatusCode::from(resp.status().as_u16());
    let len = resp.content_length().and_then(|l| usize::try_from(l).ok());
    let response = tiny_http::Response::new(status, headers, resp, len, None)
        .with_chunked_threshold(usize::MAX);
    request.respond(response).map_err(|e| e.to_string())
}

// ---- 隐藏 webview 取流 ----

const INIT_SCRIPT: &str = r#"(function () {
  if (window.__animeInjected) { return; }
  window.__animeInjected = true;
  window.__animeStreams = [];
  function isVideo(u) {
    return typeof u === 'string' && (/\.m3u8(\?|$)/i.test(u) || /\.(mp4|flv)(\?|$)/i.test(u));
  }
  function push(u) {
    try {
      if (isVideo(u) && window.__animeStreams.indexOf(u) < 0) { window.__animeStreams.push(u); }
    } catch (e) {}
  }
  try {
    var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
    if (d && d.set) {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', {
        configurable: true,
        enumerable: d.enumerable,
        get: function () { return d.get.call(this); },
        set: function (v) {
          try {
            if (typeof v === 'string') { push(v); } else if (v) { push(v.src || v.currentSrc); }
          } catch (e) {}
          return d.set.call(this, v);
        }
      });
    }
  } catch (e) {}
  try {
    var f = window.fetch;
    if (f) {
      window.fetch = function () {
        try { push(arguments.length ? (typeof arguments[0] === 'string' ? arguments[0] : (arguments[0] && arguments[0].url)) : ''); } catch (e) {}
        return f.apply(this, arguments);
      };
    }
  } catch (e) {}
  try {
    var o = XMLHttpRequest.prototype.open;
    if (o) {
      XMLHttpRequest.prototype.open = function () {
        try { push(arguments[1]); } catch (e) {}
        return o.apply(this, arguments);
      };
    }
  } catch (e) {}
  // 隐藏 webview 里站点自带的播放器会照常出声——这就是「有声音、没画面、
  // 还报取流失败」的来源：页面在自己播，而钩子没抓到地址。
  // 只静音、不 pause：暂停可能让站点播放器不再去请求真实地址，反而更抓不到。
  function mute(el) {
    try { el.muted = true; if ('volume' in el) { el.volume = 0; } } catch (e) {}
  }
  function scan() {
    try {
      var els = document.querySelectorAll('video, audio');
      for (var i = 0; i < els.length; i++) {
        mute(els[i]);
        push(els[i].currentSrc || els[i].getAttribute('src'));
      }
    } catch (e) {}
  }
  // 汇总当前能拿到的媒体地址，供 Rust 侧轮询。
  window.__animeCollect = function () {
    var out = [];
    function add(u) {
      try { if (isVideo(u) && out.indexOf(u) < 0) { out.push(u); } } catch (e) {}
    }
    try { (window.__animeStreams || []).forEach(add); } catch (e) {}
    // 站点播放器（hls.js/ckplayer 等）常经 XHR/fetch 拉清单，不经过 src setter；
    // Resource Timing 的 name 对跨域资源同样可见，是补抓的关键来源。
    try {
      var rs = performance.getEntriesByType('resource') || [];
      for (var i = 0; i < rs.length; i++) { add(rs[i].name); }
    } catch (e) {}
    try {
      var els = document.querySelectorAll('video, audio, source');
      for (var j = 0; j < els.length; j++) {
        add(els[j].currentSrc || els[j].src || els[j].getAttribute('src'));
      }
    } catch (e) {}
    return out;
  };
  try { scan(); } catch (e) {}
  try {
    if (window.MutationObserver) {
      new MutationObserver(function () { scan(); }).observe(document.documentElement, { childList: true, subtree: true });
    }
  } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () { try { scan(); } catch (e) {} });
  window.addEventListener('load', function () { try { scan(); } catch (e) {} });
})();"#;

/// 内置规则（移植 Kazumi assets/plugins；首次启动规则库为空时写入）
const BUILTIN_RULES: &[(&str, &str)] = &[(
    "7sefun",
    r#"{
  "api": "4",
  "type": "anime",
  "name": "7sefun",
  "version": "2.0",
  "muliSources": true,
  "useWebview": true,
  "useNativePlayer": true,
  "userAgent": "",
  "baseURL": "https://www.7sefun.top/",
  "referer": "https://www.7sefun.top/",
  "searchURL": "https://www.7sefun.top/vodsearch/-------------.html?wd=@keyword",
  "searchList": "//div[@class~='video']",
  "searchName": "//div[@class='video-by']",
  "searchResult": "//a[@class='video-wrapper']",
  "chapterRoads": "//div[@class~='vod-play-list-container']",
  "chapterResult": "//a"
}"#,
)];

/// 曾经随版本内置、现已下线的规则（站点关停/长期失修）。setup 时若磁盘上残留
/// 与旧内置内容完全一致的副本则清理，避免向用户展示一张注定失败的卡片。
const STALE_BUILTIN_RULES: &[(&str, &str)] = &[(
    "DM84",
    r#"{
  "api": "5",
  "type": "anime",
  "name": "DM84",
  "version": "1.0",
  "muliSources": true,
  "useWebview": true,
  "useNativePlayer": true,
  "adBlocker": true,
  "userAgent": "",
  "baseURL": "https://dmbus.cc/",
  "searchURL": "https://dmbus.cc/vodsearch/-------------.html?wd=@keyword",
  "searchList": "//div/div[3]/ul/li",
  "searchName": "//div/a[2]",
  "searchResult": "//div/a[2]",
  "chapterRoads": "//div/div[4]/div/ul",
  "chapterResult": "//li/a"
}"#,
)];

/// 在 setup 阶段预创建隐藏 webview（桌面端 webview 创建需主线程，懒建在部分平台会失败）
pub fn setup(app: &tauri::AppHandle) {
    // 内置规则同步：缺失时写入；站点结构变化致内置版本前进时，用新内置覆盖旧副本
    // （老用户首次启动即拿到修复后的规则）。仅当磁盘副本与旧内置内容完全一致时
    // 才清理已下线规则，绝不误删用户自行导入的同名规则。
    if let Ok(dir) = rules_dir(app) {
        if std::fs::create_dir_all(&dir).is_ok() {
            for (name, json) in BUILTIN_RULES {
                let path = dir.join(format!("{}.json", sanitize_rule_name(name)));
                let should_write = match std::fs::read_to_string(&path) {
                    Ok(existing) => {
                        // 内容不同（版本前进或结构修复）→ 覆盖
                        existing.trim() != json.trim()
                    }
                    Err(_) => true,
                };
                if should_write {
                    let _ = std::fs::write(&path, json.as_bytes());
                }
            }
            for (name, stale_json) in STALE_BUILTIN_RULES {
                let path = dir.join(format!("{}.json", sanitize_rule_name(name)));
                if let Ok(existing) = std::fs::read_to_string(&path) {
                    if existing.trim() == stale_json.trim() {
                        let _ = std::fs::remove_file(&path);
                    }
                }
            }
        }
    }
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    let result = WebviewWindowBuilder::new(
        app,
        WEBVIEW_LABEL,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .visible(false)
    .initialization_script(INIT_SCRIPT)
    .build();
    if let Err(e) = result {
        eprintln!("[anime] 隐藏取流 webview 创建失败（将按需重建）: {e}");
    }
}

fn ensure_webview(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(WEBVIEW_LABEL) {
        return Ok(w);
    }
    tauri::WebviewWindowBuilder::new(
        app,
        WEBVIEW_LABEL,
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .visible(false)
    .initialization_script(INIT_SCRIPT)
    .build()
    .map_err(|e| e.to_string())
}

fn pick_stream(urls: &[String]) -> Option<String> {
    urls.iter()
        .find(|u| u.contains(".m3u8"))
        .cloned()
        .or_else(|| urls.first().cloned())
}

/// 取流前注入的诊断快照脚本。
///
/// 为什么需要：gugu3 / ezdmw 这类站点把真实地址藏在运行时的 JS 里，静态提取
/// 无解，只能靠隐藏 webview；而它常常 30s 空手而归，光看「未拿到地址」根本
/// 分不清是页面没加载、播放器没启动，还是地址走了我们没钩住的路。
/// 这份快照把判断依据一次性摊开：页面就绪度 / 可见性 / video 元素数 /
/// 资源请求数与其中媒体请求的条数。
const DIAG_SCRIPT: &str = r#"(function(){
  try {
    var vids = document.querySelectorAll('video,audio');
    var srcs = [];
    for (var i = 0; i < vids.length && i < 3; i++) {
      srcs.push(vids[i].currentSrc || vids[i].getAttribute('src') || '(empty)');
    }
    var names = [];
    try {
      var e = performance.getEntriesByType('resource');
      for (var j = 0; j < e.length && j < 500; j++) { names.push(e[j].name); }
    } catch (err) {}
    var media = [];
    for (var k = 0; k < names.length && media.length < 5; k++) {
      if (/\.(m3u8|mp4|flv)(\?|#|$)/i.test(names[k])) { media.push(names[k]); }
    }
    return JSON.stringify({
      title: (document.title || '').slice(0, 60),
      href: location.href.slice(0, 160),
      ready: document.readyState,
      vis: document.visibilityState,
      bodyLen: (document.body && document.body.innerHTML.length) || 0,
      mediaEls: vids.length,
      mediaSrcs: srcs,
      resTotal: names.length,
      resMedia: media,
      hooks: (window.__animeStreams || []).length
    });
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()"#;

/// 在 webview 里求值并取回结果（`eval` 是单向的，拿不到返回值）
async fn eval_json(webview: &tauri::WebviewWindow, script: &str) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    if webview
        .eval_with_callback(script, move |res: String| {
            let _ = tx.send(res);
        })
        .is_err()
    {
        return None;
    }
    match tokio::time::timeout(Duration::from_secs(3), rx).await {
        Ok(Ok(s)) => Some(s),
        _ => None,
    }
}

/// 把当前页面状态写进调试日志（前缀 [anime-webview]）
async fn log_webview_diag(
    webview: &tauri::WebviewWindow,
    rule_name: &str,
    waited_ms: u128,
) {
    let snap = eval_json(webview, DIAG_SCRIPT)
        .await
        .unwrap_or_else(|| "(诊断脚本无返回：页面可能已跳转或未就绪)".to_string());
    crate::novel_auth::login_debug_log(&format!(
        "[app] [anime-online] [anime-webview] {} 等待 {}ms 后页面快照 {}",
        rule_name, waited_ms, snap
    ));
}

/// 取流结束后立刻让隐藏 webview 停下并清空页面。
/// 不这么做的话，站点自带播放器会在后台继续播——用户听到声音、却看不到画面
/// （画面对着一个不可见的窗口），而前端此时已经在报「取流失败」。
fn stop_webview(webview: &tauri::WebviewWindow) {
    let _ = webview.eval(
        "try{window.stop();}catch(e){}\
         try{document.querySelectorAll('video,audio').forEach(function(el){el.pause();el.muted=true;});}catch(e){}",
    );
    let _ = webview.navigate(url::Url::parse("about:blank").unwrap());
}

/// 取流兜底：隐藏 webview 加载播放页，轮询注入钩子收集到的媒体 URL。
/// 静态直链提取（前端 animeStream.ts）未命中时才走这里。
#[tauri::command]
pub async fn anime_webview_resolve(
    app: tauri::AppHandle,
    rule_name: String,
    page_url: String,
    _base_url: String,
) -> Result<Option<AnimeResolveStream>, String> {
    let parsed = url::Url::parse(&page_url).map_err(|_| "播放页 URL 无效".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("仅支持 http/https 播放页".into());
    }
    let webview = ensure_webview(&app)?;
    let gen = RESOLVE_GEN.fetch_add(1, Ordering::SeqCst) + 1;

    // 复位旧页面收集结果，再导航到目标播放页
    let _ = webview.eval("window.__animeStreams = []");
    if let Err(e) = webview.navigate(parsed.clone()) {
        return Err(format!("导航播放页失败：{e}"));
    }

    let collected: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let started = std::time::Instant::now();
    let deadline = started + WEBVIEW_TIMEOUT;
    let mut midway_diag = false;
    while std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(250)).await;
        // 中途先拍一张快照：区分「页面在慢慢跑」与「压根没动起来」
        if !midway_diag && started.elapsed() >= Duration::from_secs(10) {
            midway_diag = true;
            log_webview_diag(&webview, &rule_name, started.elapsed().as_millis()).await;
        }
        // 被更新一次取流抢占时直接放弃（并停掉页面，避免旧页面继续出声）
        if RESOLVE_GEN.load(Ordering::SeqCst) != gen {
            stop_webview(&webview);
            return Ok(None);
        }
        let collector = collected.clone();
        // 用注入脚本导出的 __animeCollect：除 src 钩子外，还会扫
        // performance resource entries + DOM 上的 video/source，捕获率更高。
        let _ = webview.eval_with_callback(
            "(window.__animeCollect && window.__animeCollect()) || window.__animeStreams || []",
            move |res: String| {
                if let Ok(urls) = serde_json::from_str::<Vec<String>>(&res) {
                    let mut all = collector.lock().unwrap();
                    for u in urls {
                        if !all.contains(&u) {
                            all.push(u);
                        }
                    }
                }
            },
        );
        let now = { collected.lock().unwrap().clone() };
        if let Some(remote) = pick_stream(&now) {
            let media = anime_media_url(app.clone(), rule_name.clone(), remote.clone())?;
            // 拿到地址后立刻停掉隐藏页，否则站点播放器继续在后台发声
            stop_webview(&webview);
            return Ok(Some(AnimeResolveStream {
                url: media.url,
                remote_url: remote,
                proxied: true,
                method: "webview".into(),
            }));
        }
    }
    // 空手而归时必须留下判断依据，否则下次还是只能靠猜
    log_webview_diag(&webview, &rule_name, started.elapsed().as_millis()).await;
    let _ = webview.eval("window.stop()");
    stop_webview(&webview);
    Ok(None)
}
