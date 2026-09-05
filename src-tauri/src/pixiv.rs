//! Pixiv（P站）在线图片模块。
//!
//! 移植自 Pixez（GPL-3.0），本仓库 GPL-3.0-only，兼容。
//!
//! 设计要点（与仓库内 anime.rs / novel_auth.rs 保持一致）：
//! - 网络走 `reqwest::blocking` + `tokio::task::spawn_blocking`，避免同步命令冻结主线程
//!   （Tauri v2 的 `#[tauri::command]` 默认在主线程事件循环内执行，阻塞 I/O 必须交出线程）。
//! - Token 持久化到 app data 目录的 `pixiv.json`，原子写（临时文件 + rename）。
//! - 鉴权请求前检查 token；收到 400/401 惰性刷新一次（用 refresh_token），再重试。
//! - Pixiv 图片服务器 `i.pximg.net` 需要 `Referer: https://app-api.pixiv.net/`，
//!   且 WebView/CSP 无法逐图设 Referer，故图片统一走 Rust 代理 `pixiv_image`。
//! - 登录用 PKCE + 隐藏/显式 WebView：打开登录页 → 拦截回调 `?code=` → 换 token。

use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

// ---- 公开客户端凭证（Pixez 现成，直接用）----
const CLIENT_ID: &str = "MOBrBDS8blbauoSck0ZfDbtuzpyT";
const CLIENT_SECRET: &str = "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj";
const HASH_SALT: &str =
    "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c";
const UA: &str = "PixivAndroidApp/5.0.155 (Android 10.0; Pixel C)";
const APP_API: &str = "https://app-api.pixiv.net";
const OAUTH_URL: &str = "https://oauth.secure.pixiv.net/auth/token";
const LOGIN_LABEL: &str = "pixiv-login";
const CALLBACK_PREFIX: &str = "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback";

// =====================================================================
// 数据模型（输出 camelCase，与前端 @shared/types 严格对应）
// =====================================================================

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivImageUrls {
    #[serde(rename(deserialize = "square_medium"), default)]
    pub square_medium: Option<String>,
    #[serde(default)]
    pub medium: Option<String>,
    #[serde(default)]
    pub large: Option<String>,
    #[serde(default)]
    pub original: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivUser {
    pub id: i64,
    pub name: String,
    pub account: String,
    #[serde(rename(deserialize = "profile_image_urls"), default)]
    pub profile_image_urls: Option<PixivImageUrls>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivTag {
    pub name: String,
    #[serde(rename(deserialize = "translated_name"), default)]
    pub translated_name: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivMetaSinglePage {
    #[serde(rename(deserialize = "original_image_url"), default)]
    pub original_image_url: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivMetaPage {
    // 同 PixivIllust.image_urls：API 是 snake_case，必须带别名
    #[serde(rename(deserialize = "image_urls"))]
    pub image_urls: PixivImageUrls,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivBookmarkData {
    #[serde(default)]
    pub id: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivIllust {
    pub id: i64,
    pub title: String,
    #[serde(rename = "type")]
    pub r#type: String,
    #[serde(rename(deserialize = "caption"), default)]
    pub caption: String,
    #[serde(rename(deserialize = "total_view"), default)]
    pub total_view: i64,
    #[serde(rename(deserialize = "total_bookmarks"), default)]
    pub total_bookmarks: i64,
    #[serde(rename(deserialize = "create_date"), default)]
    pub create_date: Option<String>,
    #[serde(rename(deserialize = "page_count"), default)]
    pub page_count: i64,
    #[serde(default)]
    pub width: i64,
    #[serde(default)]
    pub height: i64,
    #[serde(rename(deserialize = "sanity_level"), default)]
    pub sanity_level: i64,
    #[serde(default)]
    pub restrict: i64,
    #[serde(rename(deserialize = "x_restrict"), default)]
    pub x_restrict: i64,
    #[serde(default)]
    pub tags: Vec<PixivTag>,
    pub user: PixivUser,
    // 注意：Pixiv App API 的 JSON 是 snake_case；rename_all = "camelCase" 会让
    // 反序列化期望 "imageUrls"。漏掉这个别名曾导致每条作品解析必失败
    // （配合 parse_illusts 的静默跳过，表现为「登录成功但列表全空」）。
    #[serde(rename(deserialize = "image_urls"))]
    pub image_urls: PixivImageUrls,
    #[serde(rename(deserialize = "meta_single_page"), default)]
    pub meta_single_page: Option<PixivMetaSinglePage>,
    #[serde(rename(deserialize = "meta_pages"), default)]
    pub meta_pages: Vec<PixivMetaPage>,
    #[serde(rename(deserialize = "bookmark_data"), default)]
    pub bookmark_data: Option<PixivBookmarkData>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivIllustPage {
    pub illusts: Vec<PixivIllust>,
    pub next_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PixivIllustDetail {
    pub illust: PixivIllust,
    pub related: Vec<PixivIllust>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivLoginStatus {
    pub logged_in: bool,
    pub user: Option<PixivUser>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PixivSearchOpts {
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub search_target: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub bookmark_num_min: Option<i64>,
    #[serde(default)]
    pub bookmark_num_max: Option<i64>,
}

// OAuth 原始响应
#[derive(Deserialize)]
struct OAuthTokenRaw {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    user: Option<Value>,
}

// =====================================================================
// 状态与持久化
// =====================================================================

#[derive(Clone, Default)]
struct PixivState {
    access_token: Option<String>,
    refresh_token: Option<String>,
    /// 仅登录进行中临时保存，不持久化
    code_verifier: Option<String>,
    user: Option<PixivUser>,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PixivPersist {
    access_token: Option<String>,
    refresh_token: Option<String>,
    user: Option<PixivUser>,
}

static STATE: OnceLock<Mutex<PixivState>> = OnceLock::new();
static LOADED: AtomicBool = AtomicBool::new(false);

fn state() -> &'static Mutex<PixivState> {
    STATE.get_or_init(|| Mutex::new(PixivState::default()))
}

fn ensure_loaded(app: &tauri::AppHandle) {
    if !LOADED.swap(true, Ordering::SeqCst) {
        *state().lock().unwrap() = load_persist(app);
    }
}

fn persist_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用数据目录失败：{e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    Ok(dir.join("pixiv.json"))
}

fn load_persist(app: &tauri::AppHandle) -> PixivState {
    let Ok(path) = persist_path(app) else {
        return PixivState::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<PixivPersist>(&s).ok())
        .map(|p| PixivState {
            access_token: p.access_token,
            refresh_token: p.refresh_token,
            code_verifier: None,
            user: p.user,
        })
        .unwrap_or_default()
}

fn save_persist(app: &tauri::AppHandle, p: &PixivPersist) -> Result<(), String> {
    let path = persist_path(app)?;
    let json = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("写入临时文件失败：{e}"))?;
        f.write_all(json.as_bytes())
            .map_err(|e| format!("写入登录态失败：{e}"))?;
    }
    // 原子替换：同目录 rename 在大多数文件系统上是原子操作
    std::fs::rename(&tmp, &path).map_err(|e| format!("保存登录态失败：{e}"))?;
    Ok(())
}

fn persist_current(app: &tauri::AppHandle) -> Result<(), String> {
    let s = state().lock().unwrap();
    let p = PixivPersist {
        access_token: s.access_token.clone(),
        refresh_token: s.refresh_token.clone(),
        user: s.user.clone(),
    };
    save_persist(app, &p)
}

// =====================================================================
// 请求头 / 哈希 / PKCE
// =====================================================================

fn http_client() -> &'static reqwest::blocking::Client {
    static C: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .build()
            .expect("构建 reqwest 客户端失败")
    })
}

/// UTC ISO8601：`yyyy-MM-ddTHH:mm:ss+00:00`
fn client_time() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%S+00:00")
        .to_string()
}

/// X-Client-Hash = md5(X-Client-Time + hashSalt)（小写 hex）
fn client_hash(time: &str) -> String {
    use md5::{Digest, Md5};
    let mut h = Md5::new();
    h.update(time.as_bytes());
    h.update(HASH_SALT.as_bytes());
    let out = h.finalize();
    let mut s = String::with_capacity(out.len() * 2);
    for b in out {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// 标准 Pixiv App API 请求头（无论鉴权与否都带）
fn apply_common_headers(req: reqwest::blocking::RequestBuilder) -> reqwest::blocking::RequestBuilder {
    let ct = client_time();
    let ch = client_hash(&ct);
    req.header("X-Client-Time", ct)
        .header("X-Client-Hash", ch)
        .header("User-Agent", UA)
        .header("App-OS", "Android")
        .header("App-OS-Version", "Android 10.0")
        .header("App-Version", "5.0.166")
        .header("Accept-Language", "zh-CN")
}

fn generate_code_verifier() -> String {
    // 32 字节随机 → base64url（无填充）≈ 43 字符，落在 Pixiv 要求的 43–128 区间
    let mut bytes = [0u8; 32];
    let _ = getrandom::getrandom(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn code_challenge(verifier: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    let out = h.finalize();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(out)
}

fn extract_code(url: &str) -> Option<String> {
    let parsed = url::Url::parse(url).ok()?;
    parsed
        .query_pairs()
        .find(|(k, _)| k == "code")
        .map(|(_, v)| v.to_string())
}

// =====================================================================
// OAuth 与鉴权 API（均为同步，调用方用 spawn_blocking 包裹）
// =====================================================================

fn oauth_exchange_blocking(form: &[(&str, &str)]) -> Result<OAuthTokenRaw, String> {
    let client = http_client();
    let resp = apply_common_headers(client.post(OAUTH_URL))
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(form)
        .send()
        .map_err(|e| format!("OAuth 请求失败：{e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !(200..=299).contains(&status) {
        return Err(format!(
            "Pixiv 登录失败（{}）：{}",
            status,
            &text.chars().take(300).collect::<String>()
        ));
    }
    serde_json::from_str::<OAuthTokenRaw>(&text).map_err(|e| format!("解析登录响应失败：{e}"))
}

/// 从 oauth 响应的 `user` 字段提取用户信息（Pixiv 该字段可能为 null / 字段命名不稳）
fn extract_user(raw: &Option<Value>) -> Option<PixivUser> {
    let v = raw.as_ref()?;
    // OAuth 响应里 user.id 可能是数字也可能是字符串（实测不稳），两种都接受
    let id = v
        .get("id")
        .and_then(|x| {
            x.as_i64()
                .or_else(|| x.as_str().and_then(|s| s.parse::<i64>().ok()))
        })?;
    let name = v
        .get("name")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let account = v
        .get("account")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let profile = v.get("profile_image_urls").and_then(|x| x.as_object()).map(|o| {
        let mut u = PixivImageUrls::default();
        u.medium = o
            .get("medium")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        u.large = o
            .get("large")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string());
        // OAuth 的 profile_image_urls 可能是 px_170x170 / px_50x50 等旧键
        if u.medium.is_none() {
            u.medium = o
                .get("px_170x170")
                .or_else(|| o.get("px_50x50"))
                .and_then(|x| x.as_str())
                .map(|s| s.to_string());
        }
        u
    });
    Some(PixivUser {
        id,
        name,
        account,
        profile_image_urls: profile,
    })
}

/// 写入 token 到状态与磁盘；user 为 None 时保留既有 user
fn apply_token(app: &tauri::AppHandle, raw: &OAuthTokenRaw) -> Result<(), String> {
    let user = extract_user(&raw.user);
    if user.is_none() {
        crate::novel_auth::login_debug_log(
            "[pixiv] apply_token: 未从 OAuth 响应提取到 user（id 解析失败或字段缺失）",
        );
    }
    {
        let mut s = state().lock().unwrap();
        s.access_token = Some(raw.access_token.clone());
        s.refresh_token = Some(raw.refresh_token.clone());
        if let Some(u) = user {
            s.user = Some(u);
        }
    }
    persist_current(app)?;
    crate::novel_auth::login_debug_log("[pixiv] apply_token: token 已写入状态并持久化");
    Ok(())
}

fn refresh_tokens_blocking(app: &tauri::AppHandle) -> Result<(), String> {
    let rt = state()
        .lock()
        .unwrap()
        .refresh_token
        .clone()
        .ok_or("无 refresh_token，请重新登录")?;
    let raw = oauth_exchange_blocking(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &rt),
        ("client_id", CLIENT_ID),
        ("client_secret", CLIENT_SECRET),
        ("include_policy", "true"),
    ])?;
    apply_token(app, &raw)?;
    Ok(())
}

/// 鉴权 API GET。401/400 时惰性刷新一次并重试；其余错误直接返回。
fn call_api_blocking(
    app: &tauri::AppHandle,
    path: &str,
    query: &[(String, String)],
) -> Result<Value, String> {
    for attempt in 0..2 {
        let token = state().lock().unwrap().access_token.clone();
        let Some(token) = token else {
            crate::novel_auth::login_debug_log(&format!(
                "[pixiv] call_api {path}: 未登录，拒绝请求"
            ));
            return Err("未登录 Pixiv，请先登录".into());
        };
        let url = format!("{}{}", APP_API, path);
        let client = http_client();
        let mut req = apply_common_headers(client.get(&url))
            .header("Authorization", format!("Bearer {}", token));
        for (k, v) in query {
            req = req.query(&[(k.as_str(), v.as_str())]);
        }
        let started = std::time::Instant::now();
        let resp = req.send().map_err(|e| format!("Pixiv 请求失败：{e}"))?;
        let status = resp.status().as_u16();
        let text = resp.text().map_err(|e| e.to_string())?;
        crate::novel_auth::login_debug_log(&format!(
            "[pixiv] call_api {path} attempt={attempt} status={status} bytes={} cost={}ms",
            text.len(),
            started.elapsed().as_millis()
        ));
        if (status == 400 || status == 401) && attempt == 0 {
            match refresh_tokens_blocking(app) {
                Ok(()) => continue,
                Err(e) => {
                    crate::novel_auth::login_debug_log(&format!(
                        "[pixiv] call_api {path}: 刷新 token 失败：{e}"
                    ));
                    return Err("登录已过期，请重新登录".into());
                }
            }
        }
        if !(200..=299).contains(&status) {
            return Err(format!(
                "Pixiv API 返回 {}：{}",
                status,
                &text.chars().take(200).collect::<String>()
            ));
        }
        return serde_json::from_str::<Value>(&text).map_err(|e| format!("解析 Pixiv 响应失败：{e}"));
    }
    Err("Pixiv 请求重试后仍失败".into())
}

fn parse_illusts(v: &Value) -> Result<Vec<PixivIllust>, String> {
    let arr = v
        .get("illusts")
        .and_then(|x| x.as_array())
        .ok_or("响应缺少 illusts 字段")?;
    let mut out = Vec::new();
    let mut first_err: Option<String> = None;
    for it in arr {
        match serde_json::from_value::<PixivIllust>(it.clone()) {
            Ok(il) => out.push(il),
            Err(e) => {
                // 静默跳过坏条目保证可用性，但必须落日志——否则表现为
                // 「列表全空且无报错」，完全无法排查（本次教训）
                if first_err.is_none() {
                    first_err = Some(format!(
                        "id={} err={e}",
                        it.get("id").and_then(|x| x.as_i64()).unwrap_or(-1)
                    ));
                }
            }
        }
    }
    if let Some(e) = &first_err {
        crate::novel_auth::login_debug_log(&format!(
            "[pixiv] parse_illusts: {}/{} 条解析失败，首条：{e}",
            arr.len() - out.len(),
            arr.len()
        ));
    }
    Ok(out)
}

fn parse_illust_page(v: &Value) -> Result<PixivIllustPage, String> {
    let illusts = parse_illusts(v)?;
    let next_url = v
        .get("next_url")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    Ok(PixivIllustPage { illusts, next_url })
}

/// 用 authorization_code 换 token（PKCE 流程收尾）
fn exchange_code_blocking(app: &tauri::AppHandle, code: &str) -> Result<PixivLoginStatus, String> {
    let verifier = state()
        .lock()
        .unwrap()
        .code_verifier
        .take()
        .ok_or("登录流程异常：缺少 PKCE verifier")?;
    let raw = oauth_exchange_blocking(&[
        ("grant_type", "authorization_code"),
        ("code", code),
        ("code_verifier", &verifier),
        (
            "redirect_uri",
            "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback",
        ),
        ("client_id", CLIENT_ID),
        ("client_secret", CLIENT_SECRET),
        ("include_policy", "true"),
    ])?;
    apply_token(app, &raw)?;
    let user = state().lock().unwrap().user.clone();
    Ok(PixivLoginStatus {
        logged_in: true,
        user,
    })
}

// =====================================================================
// Tauri 命令
// =====================================================================

/// 启动时加载持久化登录态
pub fn setup(app: &tauri::AppHandle) {
    ensure_loaded(app);
}

/// 当前登录状态（不触发网络）
#[tauri::command]
pub fn pixiv_login_status(app: tauri::AppHandle) -> PixivLoginStatus {
    ensure_loaded(&app);
    let s = state().lock().unwrap();
    PixivLoginStatus {
        logged_in: s.access_token.is_some(),
        user: s.user.clone(),
    }
}

/// 打开 PKCE 登录 WebView，拦截回调 code 并换 token，返回登录状态。
#[tauri::command]
pub async fn pixiv_login_open(app: tauri::AppHandle) -> Result<PixivLoginStatus, String> {
    // 1. 生成 PKCE
    let verifier = generate_code_verifier();
    let challenge = code_challenge(&verifier);
    {
        let mut s = state().lock().unwrap();
        s.code_verifier = Some(verifier);
    }
    // 2. 登录 URL
    let login_url = format!(
        "{}/web/v1/login?code_challenge={}&code_challenge_method=S256&client=pixiv-android",
        APP_API, challenge
    );
    // 3. code 通道
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let slot = Arc::new(Mutex::new(Some(tx)));
    if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
        let _ = w.close();
    }
    // 4. 独立线程创建 WebView（避免主线程嵌套死锁，见 novel_auth.rs）
    let app2 = app.clone();
    let slot2 = slot.clone();
    let build = tauri::async_runtime::spawn_blocking(move || {
        WebviewWindowBuilder::new(
            &app2,
            LOGIN_LABEL,
            WebviewUrl::External(login_url.parse().unwrap()),
        )
        .title("登录 Pixiv")
        .user_agent(UA)
        .on_navigation(move |url| {
            if url.as_str().starts_with(CALLBACK_PREFIX) {
                if let Some(code) = extract_code(url.as_str()) {
                    if let Some(tx) = slot2.lock().ok().and_then(|mut g| g.take()) {
                        let _ = tx.send(code);
                    }
                }
                return false; // 拦截跳转，避免错误页
            }
            true
        })
        .build()
        .map_err(|e| format!("创建登录窗口失败：{e}"))
    })
    .await;
    if let Ok(Err(e)) = build {
        return Err(e);
    }
    // 5. 等待 code（最多 5 分钟）
    let code = match tokio::time::timeout(Duration::from_secs(300), rx).await {
        Ok(Ok(c)) => {
            crate::novel_auth::login_debug_log("[pixiv] login_open: 已拦截到回调 code");
            c
        }
        _ => {
            crate::novel_auth::login_debug_log("[pixiv] login_open: 等待 code 超时或被取消");
            if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
                let _ = w.close();
            }
            return Err("登录超时或已取消".into());
        }
    };
    if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
        let _ = w.close();
    }
    // 6. 用 code 换 token
    let app3 = app.clone();
    let res = tokio::task::spawn_blocking(move || exchange_code_blocking(&app3, &code))
        .await
        .map_err(|e| format!("任务失败：{e}"))?;
    match &res {
        Ok(st) => crate::novel_auth::login_debug_log(&format!(
            "[pixiv] login_open: 登录成功 loggedIn={} user={:?}",
            st.logged_in,
            st.user.as_ref().map(|u| (u.id, u.name.clone()))
        )),
        Err(e) => crate::novel_auth::login_debug_log(&format!("[pixiv] login_open: 换 token 失败：{e}")),
    }
    res
}

/// 用回调 code 换 token（供前端在已拿到 code 时手动调用；需先经 pixiv_login_open 生成 verifier）
#[tauri::command]
pub async fn pixiv_login_submit(
    app: tauri::AppHandle,
    code: String,
) -> Result<PixivLoginStatus, String> {
    let app2 = app.clone();
    let res = tokio::task::spawn_blocking(move || exchange_code_blocking(&app2, &code))
        .await
        .map_err(|e| format!("任务失败：{e}"))?;
    res
}

/// 退出登录：清空状态与磁盘
#[tauri::command]
pub async fn pixiv_logout(app: tauri::AppHandle) -> Result<(), String> {
    *state().lock().unwrap() = PixivState::default();
    let path = persist_path(&app)?;
    let _ = std::fs::remove_file(path);
    Ok(())
}

/// 手动设置 refresh_token 并尝试刷新（供从其它客户端迁移 token）
#[tauri::command]
pub async fn pixiv_set_refresh_token(
    app: tauri::AppHandle,
    token: String,
) -> Result<PixivLoginStatus, String> {
    {
        let mut s = state().lock().unwrap();
        s.refresh_token = Some(token);
    }
    persist_current(&app)?;
    let app2 = app.clone();
    let refreshed = tokio::task::spawn_blocking(move || refresh_tokens_blocking(&app2))
        .await
        .map_err(|e| format!("任务失败：{e}"))?
        .is_ok();
    let s = state().lock().unwrap();
    Ok(PixivLoginStatus {
        logged_in: refreshed && s.access_token.is_some(),
        user: s.user.clone(),
    })
}

/// 推荐（首页）
#[tauri::command]
pub async fn pixiv_recommended(app: tauri::AppHandle) -> Result<PixivIllustPage, String> {
    let q = vec![
        ("filter".into(), "for_ios".into()),
        ("include_ranking_label".into(), "true".into()),
    ];
    let res = tokio::task::spawn_blocking(move || {
        call_api_blocking(&app, "/v1/illust/recommended", &q).and_then(|v| parse_illust_page(&v))
    })
    .await
    .map_err(|e| format!("任务失败：{e}"))?;
    res
}

/// 排行榜（mode: day/week/month/day_male/day_female/…；date 可选 yyyy-MM-dd）
#[tauri::command]
pub async fn pixiv_ranking(
    app: tauri::AppHandle,
    mode: String,
    date: Option<String>,
) -> Result<PixivIllustPage, String> {
    let mut q = vec![("filter".into(), "for_android".into()), ("mode".into(), mode)];
    if let Some(d) = date {
        q.push(("date".into(), d));
    }
    let res = tokio::task::spawn_blocking(move || {
        call_api_blocking(&app, "/v1/illust/ranking", &q).and_then(|v| parse_illust_page(&v))
    })
    .await
    .map_err(|e| format!("任务失败：{e}"))?;
    res
}

/// 搜索（sort / search_target / 日期 / 收藏数过滤可选）
#[tauri::command]
pub async fn pixiv_search(
    app: tauri::AppHandle,
    word: String,
    opts: Option<PixivSearchOpts>,
) -> Result<PixivIllustPage, String> {
    let o = opts.unwrap_or_default();
    let mut q = vec![
        ("filter".into(), "for_android".into()),
        ("merge_plain_keyword_results".into(), "true".into()),
        ("word".into(), word),
    ];
    if let Some(s) = o.sort {
        q.push(("sort".into(), s));
    }
    if let Some(s) = o.search_target {
        q.push(("search_target".into(), s));
    }
    if let Some(s) = o.start_date {
        q.push(("start_date".into(), s));
    }
    if let Some(s) = o.end_date {
        q.push(("end_date".into(), s));
    }
    if let Some(n) = o.bookmark_num_min {
        q.push(("bookmark_num_min".into(), n.to_string()));
    }
    if let Some(n) = o.bookmark_num_max {
        q.push(("bookmark_num_max".into(), n.to_string()));
    }
    let res = tokio::task::spawn_blocking(move || {
        call_api_blocking(&app, "/v1/search/illust", &q).and_then(|v| parse_illust_page(&v))
    })
    .await
    .map_err(|e| format!("任务失败：{e}"))?;
    res
}

/// 作品详情 + 相关推荐
#[tauri::command]
pub async fn pixiv_illust_detail(
    app: tauri::AppHandle,
    id: i64,
) -> Result<PixivIllustDetail, String> {
    let app2 = app.clone();
    let res = tokio::task::spawn_blocking(move || -> Result<PixivIllustDetail, String> {
        let v = call_api_blocking(
            &app2,
            "/v1/illust/detail",
            &[
                ("filter".into(), "for_android".into()),
                ("illust_id".into(), id.to_string()),
            ],
        )?;
        let illust_val = v.get("illust").ok_or("响应缺少 illust 字段")?;
        let illust: PixivIllust = serde_json::from_value(illust_val.clone())
            .map_err(|e| format!("解析作品失败：{e}"))?;
        // 相关推荐（失败不致命）
        let related = call_api_blocking(
            &app2,
            "/v2/illust/related",
            &[
                ("filter".into(), "for_android".into()),
                ("illust_id".into(), id.to_string()),
            ],
        )
        .ok()
        .and_then(|rv| parse_illusts(&rv).ok())
        .unwrap_or_default();
        Ok(PixivIllustDetail { illust, related })
    })
    .await
    .map_err(|e| format!("任务失败：{e}"))?;
    res
}

/// 关注流（restrict: all/public/private）
#[tauri::command]
pub async fn pixiv_follow(
    app: tauri::AppHandle,
    restrict: String,
) -> Result<PixivIllustPage, String> {
    let q = vec![("restrict".into(), restrict)];
    let res = tokio::task::spawn_blocking(move || {
        call_api_blocking(&app, "/v2/illust/follow", &q).and_then(|v| parse_illust_page(&v))
    })
    .await
    .map_err(|e| format!("任务失败：{e}"))?;
    res
}

/// 翻页：next_url 直接 GET（统一 host 为 app-api.pixiv.net）
#[tauri::command]
pub async fn pixiv_next(
    app: tauri::AppHandle,
    next_url: String,
) -> Result<PixivIllustPage, String> {
    let parsed = url::Url::parse(&next_url).map_err(|e| format!("next_url 解析失败：{e}"))?;
    let path = parsed.path().to_string();
    let query: Vec<(String, String)> = parsed
        .query_pairs()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
    let res = tokio::task::spawn_blocking(move || {
        call_api_blocking(&app, &path, &query).and_then(|v| parse_illust_page(&v))
    })
    .await
    .map_err(|e| format!("任务失败：{e}"))?;
    res
}

/// 图片代理：i.pximg.net 需要 Referer，WebView 无法逐图设，故走 Rust 拉字节返回。
#[tauri::command]
pub async fn pixiv_image(_app: tauri::AppHandle, url: String) -> Result<Vec<u8>, String> {
    let url_for_log = url.clone(); // url 会 move 进闭包，日志用克隆
    let res = tokio::task::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let client = http_client();
        let resp = client
            .get(&url)
            .header("Referer", "https://app-api.pixiv.net/")
            .header("User-Agent", UA)
            .send()
            .map_err(|e| format!("图片代理请求失败：{e}"))?;
        let status = resp.status().as_u16();
        if !(200..=299).contains(&status) {
            crate::novel_auth::login_debug_log(&format!("[pixiv] image: HTTP {status} url={url}"));
            return Err(format!("图片代理返回 HTTP {}", status));
        }
        let bytes = resp.bytes().map_err(|e| e.to_string())?;
        Ok(bytes.to_vec())
    })
    .await
    .map_err(|e| format!("任务失败：{e}"))?;
    match &res {
        Ok(b) if b.len() < 1024 => crate::novel_auth::login_debug_log(&format!(
            "[pixiv] image: 可疑小图 {}B url={url_for_log}",
            b.len()
        )),
        Err(e) => {
            crate::novel_auth::login_debug_log(&format!("[pixiv] image: 失败 url={url_for_log}：{e}"))
        }
        _ => {}
    }
    res
}
