//! Wenku8 登录态模块。
//!
//! 移植自参考项目（Flutter Hikari Novel）的登录系统：
//! - 登录方式：内嵌 WebView 打开 Wenku8 登录页，由用户在网页内完成登录，
//!   前端从 WebView 提取 `jieqiUserInfo` + `jieqiVisitInfo` 两个 cookie 后提交给本模块。
//! - 持久化：仿 `netease.rs`，写入 app data 目录的 `wenku8.json`。
//! - 注入：所有 Wenku8 请求（见 `novel.rs::fetch_html`）自动带上该 cookie，
//!   覆盖 `.net` 与 `.cc` 两个节点域名（参考项目特意双域名注入）。
//! - 过期检测：当登录态失效时 Wenku8 会返回登录跳转页/空数据，
//!   由 `is_login_required` 判定，前端据此提示重新登录。

use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::novel::{fetch_html, NovelShelfItem};

// ---- 常量 ----

const PERSIST_FILE: &str = "wenku8.json";

// ---- 持久化结构 ----

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Wenku8Persist {
    /// 形如 "jieqiUserInfo=...; jieqiVisitInfo=..."
    pub cookie: Option<String>,
    pub user_info: Option<Wenku8UserInfo>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Wenku8UserInfo {
    pub uid: String,
    pub uname: String,
    pub nickname: String,
    pub group: String,
    pub avatar: String,
    pub message_count: String,
    pub experience: String,
    pub credit: String,
    pub point: String,
    pub vip: String,
}

/// 登录状态（前端展示用）
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Wenku8LoginStatus {
    pub logged_in: bool,
    pub uname: Option<String>,
    pub nickname: Option<String>,
}

/// 登录态需要的 cookie 字段（参考项目判定登录成功的依据）
pub const REQUIRED_COOKIE_KEYS: &[&str] = &["jieqiUserInfo", "jieqiVisitInfo"];

static STATE: OnceLock<Mutex<Wenku8Persist>> = OnceLock::new();
static LOADED: AtomicBool = AtomicBool::new(false);

fn state() -> &'static Mutex<Wenku8Persist> {
    STATE.get_or_init(|| Mutex::new(Wenku8Persist::default()))
}

fn ensure_loaded(app: &tauri::AppHandle) {
    if !LOADED.swap(true, Ordering::SeqCst) {
        *state().lock().unwrap() = load_persist(app);
    }
}

fn persist_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    Ok(dir.join(PERSIST_FILE))
}

fn load_persist(app: &tauri::AppHandle) -> Wenku8Persist {
    let Ok(path) = persist_path(app) else {
        return Wenku8Persist::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Wenku8Persist>(&s).ok())
        .unwrap_or_default()
}

fn save_persist(app: &tauri::AppHandle, p: &Wenku8Persist) -> Result<(), String> {
    let path = persist_path(app)?;
    let json = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("保存 Wenku8 登录态失败：{e}"))
}

/// 校验提交上来的 cookie 是否包含登录所需字段。
/// 参考项目判定登录成功：Cookie 中同时存在 jieqiUserInfo 与 jieqiVisitInfo。
fn cookie_has_required(cookie: &str) -> bool {
    let lower = cookie.to_lowercase();
    REQUIRED_COOKIE_KEYS.iter().all(|k| {
        lower
            .split(';')
            .map(|kv| kv.trim().to_lowercase())
            .any(|kv| kv.starts_with(&format!("{}==", k.to_lowercase()))
                || kv.starts_with(&format!("{} =", k.to_lowercase())))
    })
}

// ---- 对外辅助（供 novel.rs 调用）----

/// 取出当前 cookie（已 ensure_loaded）。无登录态返回 None。
pub fn current_cookie(app: &tauri::AppHandle) -> Option<String> {
    ensure_loaded(app);
    state().lock().unwrap().cookie.clone()
}

/// 判定 Wenku8 响应是否需要登录（cookie 过期/未登录）。
/// 参考项目经验：未登录访问受保护页会返回登录跳转或含 "login.php" 的页面。
pub fn is_login_required(html: &str) -> bool {
    let h = html;
    // 重定向到登录页
    if h.contains("wenku8.net/login.php")
        || h.contains("wenku8.cc/login.php")
        || h.contains("window.location.href='/login.php'")
        || h.contains("window.location='login.php'")
    {
        return true;
    }
    // 登录页特征文本
    if h.contains("用户登录") && h.contains("name=\"username\"") {
        return true;
    }
    false
}

// ---- Tauri 命令 ----

/// 前端 WebView 登录完成后提交 cookie。校验通过后持久化，并立即拉取用户信息。
/// 成功后由 Rust 侧主动关闭登录窗口（远程页 window.close 不可靠）。
#[tauri::command]
pub fn wenku8_login_submit(
    app: tauri::AppHandle,
    cookie: String,
) -> Result<Wenku8LoginStatus, String> {
    if !cookie_has_required(&cookie) {
        return Err("cookie 缺少 jieqiUserInfo / jieqiVisitInfo，登录未完成".into());
    }
    ensure_loaded(&app);
    {
        let mut s = state().lock().unwrap();
        s.cookie = Some(cookie.trim().to_string());
        s.user_info = None;
    }
    // 拉取用户信息并保存
    let user = wenku8_fetch_userinfo(&app).ok().flatten();
    {
        let mut s = state().lock().unwrap();
        s.user_info = user.clone();
        save_persist(&app, &s)?;
    }
    // 延迟关闭登录窗口，确保本次 invoke 先返回
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        if let Some(w) = app2.get_webview_window("wenku8-login") {
            let _ = w.close();
        }
    });
    Ok(Wenku8LoginStatus {
        logged_in: true,
        uname: user.as_ref().map(|u| u.uname.clone()),
        nickname: user.as_ref().map(|u| u.nickname.clone()),
    })
}

/// 返回当前登录状态（不触发网络）。
#[tauri::command]
pub fn wenku8_login_status(app: tauri::AppHandle) -> Wenku8LoginStatus {
    ensure_loaded(&app);
    let s = state().lock().unwrap();
    let logged_in = s.cookie.is_some();
    Wenku8LoginStatus {
        logged_in,
        uname: s.user_info.as_ref().map(|u| u.uname.clone()),
        nickname: s.user_info.as_ref().map(|u| u.nickname.clone()),
    }
}

/// 退出登录：清空本地 cookie 与用户信息。
#[tauri::command]
pub fn wenku8_logout(app: tauri::AppHandle) -> Result<(), String> {
    ensure_loaded(&app);
    {
        let mut s = state().lock().unwrap();
        *s = Wenku8Persist::default();
        save_persist(&app, &s)?;
    }
    Ok(())
}

/// 返回已保存的用户信息（若曾拉取过）。
#[tauri::command]
pub fn wenku8_userinfo(app: tauri::AppHandle) -> Option<Wenku8UserInfo> {
    ensure_loaded(&app);
    state().lock().unwrap().user_info.clone()
}

/// 注入到登录窗口的脚本：移除临时登录选项、轮询 cookie，
/// 登录成功（cookie 含 jieqiUserInfo + jieqiVisitInfo）后提交并关闭窗口。
/// 通过 initialization_script 注入，在 DOMContentLoaded 后执行避免阻塞渲染。
/// 提交成功后由 Rust 侧主动关闭窗口（远程页 window.close 不可靠）。
const LOGIN_INJECT_JS: &str = r#"
(function () {
  function run() {
    function stripTempCookie() {
      try {
        const sel = document.querySelector('select[name="usecookie"]');
        if (sel) {
          for (const opt of Array.from(sel.options)) {
            if (opt.value === '0') opt.remove();
          }
          if (!sel.value) sel.value = '1';
        }
      } catch (e) {}
    }
    function hasAll() {
      const c = document.cookie || '';
      return c.includes('jieqiUserInfo') && c.includes('jieqiVisitInfo');
    }
    async function submit() {
      try {
        const cookie = document.cookie;
        if (window.__TAURI__ && window.__TAURI__.core) {
          await window.__TAURI__.core.invoke('wenku8_login_submit', { cookie });
        }
      } catch (e) { console.error('wenku8 submit failed', e); }
    }
    stripTempCookie();
    if (hasAll()) { submit(); return; }
    const iv = setInterval(() => {
      stripTempCookie();
      if (hasAll()) { clearInterval(iv); submit(); }
    }, 600);
    setTimeout(() => clearInterval(iv), 600000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
"#;

/// 打开登录窗口并由 Rust 侧注入抓取脚本。
/// 使用 WebviewWindowBuilder.initialization_script（v2 无 eval API，
/// 该方式在每次页面加载前注入，无需额外权限）。
/// 设置浏览器 UA：wenku8 对 WebView2 默认 UA 会返回空白页（参考项目同样设置 Edge UA）。
#[tauri::command]
pub fn wenku8_login_open(app: tauri::AppHandle) -> Result<(), String> {
    let label = "wenku8-login";
    // 若已存在则先关闭，避免重复窗口
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.close();
    }
    tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(
        "https://www.wenku8.net/login.php".parse().unwrap(),
    ))
    .title("登录轻小说网 Wenku8")
    .inner_size(440.0, 680.0)
    .resizable(true)
    .center()
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0")
    .initialization_script(LOGIN_INJECT_JS)
    .build()
    .map_err(|e| format!("创建登录窗口失败：{e}"))?;
    Ok(())
}

/// 在线书架（bookcase.php）。需要登录态，未登录/过期时返回明确的“需登录”错误。
#[tauri::command]
pub fn wenku8_shelf_online(app: tauri::AppHandle, node: String) -> Result<Vec<NovelShelfItem>, String> {
    ensure_loaded(&app);
    let html = fetch_html(
        &app,
        &node,
        "GBK",
        "/modules/article/bookcase.php",
    )?;
    if is_login_required(&html) {
        return Err("[WENKU8_LOGIN_REQUIRED] 登录态已失效，请重新登录".into());
    }
    let items = parse_bookcase(&html);
    Ok(items)
}

// ---- 内部解析（移植自参考项目 Api.getBookshelf / Parser.getBookshelf）----

fn parse_bookcase(html: &str) -> Vec<NovelShelfItem> {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);
    let mut out = Vec::new();
    // 参考项目：<tbody> 中每行 <a href="/book/<aid>.htm"> 标题 </a> + 作者
    let tbody = Selector::parse("tbody").unwrap();
    let a_sel = Selector::parse("a").unwrap();
    for body in doc.select(&tbody) {
        for a in body.select(&a_sel) {
            let href = a.value().attr("href").unwrap_or("").to_string();
            if !href.contains("/book/") {
                continue;
            }
            // 提取 aid：/book/1234.htm 或 /book/1234/
            let aid = href
                .trim_end_matches('/')
                .trim_end_matches(".htm")
                .rsplit('/')
                .next()
                .unwrap_or("")
                .to_string();
            if aid.is_empty() || !aid.chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let title = a.text().collect::<Vec<_>>().join("").trim().to_string();
            if title.is_empty() {
                continue;
            }
            // 作者：同行内 <td> 文本
            let author = body
                .text()
                .collect::<Vec<_>>()
                .join(" ")
                .split_whitespace()
                .collect::<Vec<_>>()
                .last()
                .map(|s| s.to_string())
                .unwrap_or_default();
            out.push(NovelShelfItem {
                aid,
                title,
                author,
                cover: String::new(),
                added_at: crate::commands::now_ms(),
                online: true,
            });
        }
    }
    out
}

/// 拉取用户信息（userdetail.php）。返回 None 表示未登录。
fn wenku8_fetch_userinfo(app: &tauri::AppHandle) -> Result<Option<Wenku8UserInfo>, String> {
    let html = fetch_html(app, "net", "GBK", "/userdetail.php")?;
    if is_login_required(&html) {
        return Ok(None);
    }
    Ok(parse_userdetail(&html))
}

fn parse_userdetail(html: &str) -> Option<Wenku8UserInfo> {
    use scraper::{Html, Selector};
    let doc = Html::parse_document(html);
    let mut info = Wenku8UserInfo::default();

    // 用户名：<span class="user-name"> / 页面标题
    if let Ok(sel) = Selector::parse("span.user-name") {
        if let Some(n) = doc.select(&sel).next() {
            info.uname = n.text().collect::<Vec<_>>().join("").trim().to_string();
        }
    }
    // 昵称：<span class="user-nickname"> 或 欢迎语
    if let Ok(sel) = Selector::parse("span.user-nickname") {
        if let Some(n) = doc.select(&sel).next() {
            info.nickname = n.text().collect::<Vec<_>>().join("").trim().to_string();
        }
    }
    // 头像
    if let Ok(sel) = Selector::parse("img.avatar") {
        if let Some(img) = doc.select(&sel).next() {
            info.avatar = img.value().attr("src").unwrap_or("").to_string();
        }
    }
    // 通用字段抓取（参考项目 UserInfo 字段）
    if let Ok(sel) = Selector::parse("span.user-mgroup") {
        if let Some(n) = doc.select(&sel).next() {
            info.group = n.text().collect::<Vec<_>>().join("").trim().to_string();
        }
    }
    if let Ok(sel) = Selector::parse("span.user-message") {
        if let Some(n) = doc.select(&sel).next() {
            info.message_count = n.text().collect::<Vec<_>>().join("").trim().to_string();
        }
    }
    if let Ok(sel) = Selector::parse("span.user-experience") {
        if let Some(n) = doc.select(&sel).next() {
            info.experience = n.text().collect::<Vec<_>>().join("").trim().to_string();
        }
    }
    if let Ok(sel) = Selector::parse("span.user-credit") {
        if let Some(n) = doc.select(&sel).next() {
            info.credit = n.text().collect::<Vec<_>>().join("").trim().to_string();
        }
    }
    if let Ok(sel) = Selector::parse("span.user-point") {
        if let Some(n) = doc.select(&sel).next() {
            info.point = n.text().collect::<Vec<_>>().join("").trim().to_string();
        }
    }
    if let Ok(sel) = Selector::parse("span.user-vip") {
        if let Some(n) = doc.select(&sel).next() {
            info.vip = n.text().collect::<Vec<_>>().join("").trim().to_string();
        }
    }
    if info.uname.is_empty() && info.nickname.is_empty() {
        return None;
    }
    Some(info)
}
