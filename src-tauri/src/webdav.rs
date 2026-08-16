//! WebDAV 适配器。
//!
//! 设置页配置服务器地址与凭据；凭据只存 Rust 进程内（`CONFIG` 静态单例，
//! 与 SMTC 同模式），WebView 永远拿不到：
//! - 目录列举 / 连接测试：`webdav_list` / `webdav_test` 直接发 PROPFIND（depth=1）；
//! - 媒体访问：`webdav_media_url` 返回 `http://127.0.0.1:<port>/webdav?u=<base64url>`
//!   的本地代理 URL。代理带凭据并透传 `Range` 转发远端，媒体元素因此支持
//!   拖动进度（206 / Content-Range），逐字歌词 FFT 的 fetch 靠 ACAO: * 跨域。
//! 代理只接受配置的 base_url 前缀之下的路径，不能当作任意 URL 跳板。

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::Serialize;

/// URL 路径段编码集：除 unreserved（A-Z a-z 0-9 - . _ ~）外全部 percent-encode
const PATH_SEGMENT_ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// WebDAV 连接配置（凭据不落前端）
#[derive(Clone, Debug)]
struct WebDavConfig {
    /// 归一化后的根 URL，以 "/" 结尾（如 https://host/remote.php/dav/files/user/）
    base_url: String,
    username: String,
    password: String,
}

static CONFIG: OnceLock<Mutex<Option<WebDavConfig>>> = OnceLock::new();

fn config() -> &'static Mutex<Option<WebDavConfig>> {
    CONFIG.get_or_init(|| Mutex::new(None))
}

/// 共享的阻塞 HTTP 客户端。总超时不能设在 client 上（媒体流可能很长），
/// 只在目录列举这类小请求上用请求级 timeout。
static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

fn client() -> &'static reqwest::blocking::Client {
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .build()
            .expect("webdav http client")
    })
}

/// 本地媒体代理基址（127.0.0.1 随机端口），首次需要时惰性启动
static PROXY_BASE: OnceLock<String> = OnceLock::new();

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop>
  <d:displayname/><d:getcontentlength/><d:getlastmodified/><d:resourcetype/>
</d:prop></d:propfind>"#;

/// 目录条目（与前端 `WebDavEntry` 对应）
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebDavEntry {
    pub name: String,
    /// 相对根目录的路径，段间 "/" 分隔（不含首尾 "/"）
    pub path: String,
    pub is_dir: bool,
    pub size: i64,
    pub mtime: i64,
}

/// 连接测试结果（与前端 `WebDavStatus` 对应）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavStatus {
    pub ok: bool,
    pub root_name: Option<String>,
}

/// 归一化服务器地址：补 scheme、去 query/fragment、确保以 "/" 结尾。
/// 非法地址返回 None。
fn normalize_base_url(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let with_scheme = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let mut url = url::Url::parse(&with_scheme).ok()?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return None;
    }
    url.set_query(None);
    url.set_fragment(None);
    let mut path = url.path().to_string();
    if !path.ends_with('/') {
        path.push('/');
    }
    url.set_path(&path);
    Some(url.to_string())
}

/// 校验相对路径：拒绝 ".." 逃逸；返回去掉首尾 "/" 的规范形（"" 表示根目录）
fn normalize_path(path: &str) -> Result<String, String> {
    let p = path.trim().trim_matches('/');
    for seg in p.split('/') {
        if seg == ".." {
            return Err("路径不能包含 ..".into());
        }
    }
    Ok(p.to_string())
}

/// 相对路径 → 请求 URL 的路径部分（逐段 percent-encode，中文/空格安全）
fn encode_path(path: &str) -> String {
    path.split('/')
        .filter(|s| !s.is_empty())
        .map(|seg| utf8_percent_encode(seg, PATH_SEGMENT_ENCODE_SET).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

/// href → 相对根目录的路径：先 percent-decode；绝对 URL 只取 path；
/// 再去掉 base 的路径前缀。
fn rel_path_of(href: &str, base_url: &str) -> String {
    let decoded = percent_decode_str(href).decode_utf8_lossy();
    let path = if let Ok(u) = url::Url::parse(&decoded) {
        u.path().to_string()
    } else {
        decoded.to_string()
    };
    let base_path = url::Url::parse(base_url)
        .map(|u| u.path().to_string())
        .unwrap_or_default();
    let stripped = if path.starts_with(&base_path) {
        path[base_path.len()..].to_string()
    } else {
        path
    };
    stripped.trim_matches('/').to_string()
}

fn http_date_secs(s: &str) -> Option<i64> {
    let t = httpdate::parse_http_date(s.trim()).ok()?;
    Some(t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64)
}

fn auth_header(cfg: &WebDavConfig) -> String {
    let raw = format!("{}:{}", cfg.username, cfg.password);
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw.as_bytes())
    )
}

/// 发 PROPFIND（depth=1），返回 (HTTP 状态码, 响应文本)
fn propfind(cfg: &WebDavConfig, remote_url: &str) -> Result<(u16, String), String> {
    let method = reqwest::Method::from_bytes(b"PROPFIND").map_err(|e| e.to_string())?;
    let resp = client()
        .request(method, remote_url)
        .header("Depth", "1")
        .header("Content-Type", "application/xml; charset=utf-8")
        .header("Authorization", auth_header(cfg))
        .body(PROPFIND_BODY)
        .timeout(Duration::from_secs(30))
        .send()
        .map_err(|e| format!("无法连接服务器：{e}"))?;
    let status = resp.status().as_u16();
    let body = resp.text().map_err(|e| format!("读取服务器响应失败：{e}"))?;
    Ok((status, body))
}

/// 把 HTTP 状态码映射成可读错误（沿用现有命令的中文错误风格）
fn http_error(status: u16) -> String {
    match status {
        401 => format!("认证失败，请检查用户名与密码（HTTP {status}）"),
        403 => format!("没有访问权限（HTTP {status}）"),
        404 => format!("目录或文件不存在（HTTP {status}）"),
        405 => format!("服务器不支持 WebDAV（HTTP {status}）"),
        _ => format!("WebDAV 请求失败（HTTP {status}）"),
    }
}

/// 解析 PROPFIND 响应；`requested` 为当前请求的相对路径（"" 表示根），
/// 用于跳过响应里的自身条目。目录在前、名称不区分大小写排序。
fn parse_propfind(xml: &str, base_url: &str, requested: &str) -> Vec<WebDavEntry> {
    let mut out = Vec::new();
    let doc = match roxmltree::Document::parse(xml) {
        Ok(d) => d,
        Err(_) => return out,
    };
    let req = requested.trim_end_matches('/');
    for resp in doc.descendants().filter(|n| n.has_tag_name("response")) {
        let Some(href) = resp
            .descendants()
            .find(|n| n.has_tag_name("href"))
            .and_then(|n| n.text())
            .map(|s| s.trim())
        else {
            continue;
        };
        let rel = rel_path_of(href, base_url);
        if rel.is_empty() || rel.trim_end_matches('/') == req {
            continue; // 自身条目 / 空路径
        }
        let is_dir = resp.descendants().any(|n| n.has_tag_name("collection"));
        let size = resp
            .descendants()
            .find(|n| n.has_tag_name("getcontentlength"))
            .and_then(|n| n.text())
            .and_then(|t| t.trim().parse::<i64>().ok())
            .unwrap_or(0);
        let mtime = resp
            .descendants()
            .find(|n| n.has_tag_name("getlastmodified"))
            .and_then(|n| n.text())
            .and_then(http_date_secs)
            .unwrap_or(0);
        let name = resp
            .descendants()
            .find(|n| n.has_tag_name("displayname"))
            .and_then(|n| n.text())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                rel.trim_end_matches('/')
                    .rsplit('/')
                    .next()
                    .unwrap_or(&rel)
                    .to_string()
            });
        out.push(WebDavEntry {
            name,
            path: rel.trim_end_matches('/').to_string(),
            is_dir,
            size,
            mtime,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    out
}

fn current_config() -> Result<WebDavConfig, String> {
    config()
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| "尚未配置 WebDAV 服务器".to_string())
}

// ---- Tauri 命令 ----

/// 推送 WebDAV 配置（设置页字段变化时由前端调用）
#[tauri::command]
pub fn webdav_configure(url: String, username: String, password: String) -> Result<(), String> {
    let base_url =
        normalize_base_url(&url).ok_or_else(|| "WebDAV 服务器地址无效".to_string())?;
    *config().lock().map_err(|e| e.to_string())? = Some(WebDavConfig {
        base_url,
        username,
        password,
    });
    Ok(())
}

/// 列举目录内容（PROPFIND depth=1）
#[tauri::command]
pub fn webdav_list(path: String) -> Result<Vec<WebDavEntry>, String> {
    let cfg = current_config()?;
    let rel = normalize_path(&path)?;
    let remote = if rel.is_empty() {
        cfg.base_url.clone()
    } else {
        format!("{}{}", cfg.base_url, encode_path(&rel))
    };
    let (status, body) = propfind(&cfg, &remote)?;
    match status {
        200 | 207 => Ok(parse_propfind(&body, &cfg.base_url, &rel)),
        _ => Err(http_error(status)),
    }
}

/// 连接测试：PROPFIND 根目录，成功返回根目录 displayname
#[tauri::command]
pub fn webdav_test() -> Result<WebDavStatus, String> {
    let cfg = current_config()?;
    let (status, body) = propfind(&cfg, &cfg.base_url)?;
    if !matches!(status, 200 | 207) {
        return Err(http_error(status));
    }
    let root_name = roxmltree::Document::parse(&body).ok().and_then(|doc| {
        doc.descendants()
            .find(|n| n.has_tag_name("response"))
            .and_then(|r| r.descendants().find(|n| n.has_tag_name("displayname")))
            .and_then(|n| n.text())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    });
    Ok(WebDavStatus {
        ok: true,
        root_name,
    })
}

/// 生成媒体访问的本地代理 URL（不含任何凭据）
#[tauri::command]
pub fn webdav_media_url(path: String) -> Result<String, String> {
    let cfg = current_config()?;
    let rel = normalize_path(&path)?;
    let remote = if rel.is_empty() {
        cfg.base_url.clone()
    } else {
        format!("{}{}", cfg.base_url, encode_path(&rel))
    };
    let proxy = proxy_base().ok_or_else(|| "WebDAV 本地代理启动失败".to_string())?;
    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(remote.as_bytes());
    Ok(format!("{proxy}/webdav?u={encoded}"))
}

// ---- 本地媒体代理 ----

/// 惰性启动本地代理（127.0.0.1 随机端口）；启动失败返回 None。
/// 每个请求在独立线程处理，互不阻塞（视频流与缩略图可并发）。
fn proxy_base() -> Option<String> {
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
                if let Err(e) = handle_proxy_request(request) {
                    eprintln!("[WebDAV] 代理请求失败: {e}");
                }
            });
        }
    });
    let base = format!("http://127.0.0.1:{port}");
    let _ = PROXY_BASE.set(base.clone());
    Some(base)
}

fn header(name: &str, value: &str) -> Option<tiny_http::Header> {
    format!("{name}: {value}").parse().ok()
}

fn respond_text(
    request: tiny_http::Request,
    status: tiny_http::StatusCode,
    text: String,
) -> Result<(), String> {
    let len = text.len();
    let mut headers = Vec::new();
    if let Some(h) = header("Access-Control-Allow-Origin", "*") {
        headers.push(h);
    }
    // Vec<u8> 不实现 Read，需 Cursor 包装
    let body = std::io::Cursor::new(text.into_bytes());
    let response = tiny_http::Response::new(status, headers, body, Some(len), None);
    request.respond(response).map_err(|e| e.to_string())
}

/// 单次代理请求：校验 → 带凭据 + Range 转发远端 → 流式回传
fn handle_proxy_request(request: tiny_http::Request) -> Result<(), String> {
    if !matches!(request.method(), tiny_http::Method::Get) {
        return respond_text(request, tiny_http::StatusCode(405), "method not allowed".into());
    }
    let (path, query) = match request.url().split_once('?') {
        Some((p, q)) => (p, q),
        None => (request.url(), ""),
    };
    if path != "/webdav" {
        return respond_text(request, tiny_http::StatusCode(404), "not found".into());
    }
    let Some(remote) = query
        .split('&')
        .find_map(|kv| kv.strip_prefix("u="))
        .and_then(|u| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(u).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
    else {
        return respond_text(request, tiny_http::StatusCode(400), "bad request".into());
    };

    let cfg = current_config()?;
    // 只允许代理配置的 base_url 前缀之下的 URL，杜绝任意 URL 跳板
    if !remote.starts_with(&cfg.base_url) {
        return respond_text(request, tiny_http::StatusCode(403), "forbidden".into());
    }

    let mut builder = client().get(&remote).header("Authorization", auth_header(&cfg));
    if let Some(range) = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Range"))
        // AsciiString 无固有 as_str：经 Deref 命中 AsciiStr::as_str()，返回 &str
        .map(|h| h.value.as_str())
    {
        builder = builder.header("Range", range);
    }
    let resp = builder.send().map_err(|e| format!("代理请求远端失败: {e}"))?;

    // 远端失败（404 等）时把状态码透传，媒体元素与 fetch 均能识别错误
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
        if let Some(h) = header("Content-Type", ct) {
            headers.push(h);
        }
    }
    if let Some(cr) = resp
        .headers()
        .get("content-range")
        .and_then(|v| v.to_str().ok())
    {
        if let Some(h) = header("Content-Range", cr) {
            headers.push(h);
        }
    }
    // Range 支持声明：媒体元素据此决定是否可拖动进度
    if let Some(h) = header("Accept-Ranges", "bytes") {
        headers.push(h);
    }
    // 逐字歌词 FFT 分析用 fetch() 拉取音频，需要跨域许可
    if let Some(h) = header("Access-Control-Allow-Origin", "*") {
        headers.push(h);
    }
    if let Some(h) = header(
        "Access-Control-Expose-Headers",
        "Content-Range, Content-Length, Accept-Ranges",
    ) {
        headers.push(h);
    }

    let status = tiny_http::StatusCode::from(resp.status().as_u16());
    let len = resp.content_length().and_then(|l| usize::try_from(l).ok());
    // 默认 32KB 阈值会让媒体流走 chunked（无 Content-Length），对拖动进度不友好；
    // 只要长度已知就强制 identity + Content-Length；未知长度（上游 chunked）仍回退 chunked
    let response = tiny_http::Response::new(status, headers, resp, len, None)
        .with_chunked_threshold(usize::MAX);
    request
        .respond(response)
        .map_err(|e| format!("响应写入失败: {e}"))
}