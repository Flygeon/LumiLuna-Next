//! 酷狗音乐账号模块：扫码 / 手机号登录、账号信息、音乐解析（播放地址）、
//! 每日签到（畅听 VIP + 概念版升级），以及搜索 / 歌单 / 排行榜 / 每日推荐。
//!
//! 实现形态：本模块只做「宿主命令层」——网络请求全部交给 vendored 的
//! `kugou_server` crate（`bridge::call` 进程内直调其路由表，不开本地端口、
//! 不走 CORS、不经过 WebView）。凭据（cookie jar）只存在于 Rust 侧并持久化在
//! app data 目录，与 `netease.rs` 同一约定。
//!
//! 上游参考实现：MD3Music（AGPL-3.0）内嵌的 `kugou_api_server/rust`。
//!
//! ## 关于列表类接口返回 `serde_json::Value`
//!
//! 酷狗的上游响应存在两套字段形态（新版 `FileHash`/`SongName`/`Singers[]`
//! 与旧版 `hash`/`songname`/`singername`），同一个字段还常有多个候选名。
//! 这类容错归一化放在 `src/utils/kugou.ts` 里与既有 `meting.ts` 的做法一致
//! （第三方音乐接口的响应整形统一在 TS 侧），本层只负责取数与登录态。

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use base64::Engine;
use chrono::{FixedOffset, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

/// 登录态持久化文件名（app data 目录）
const PERSIST_FILE: &str = "kugou.json";

// ---- 持久化状态 ----

/// 酷狗账号信息
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KugouProfile {
    pub userid: i64,
    #[serde(default)]
    pub nickname: String,
    #[serde(default)]
    pub avatar: String,
    /// 会员类型（cookie `vip_type`）
    #[serde(default)]
    pub vip_type: i64,
}

/// 落盘数据：cookie jar + 账号信息 + 本地签到记录
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct KugouPersist {
    /// cookie jar，`k=v; k=v`（含 token / userid / vip_token 等凭据）
    #[serde(default)]
    cookie: String,
    #[serde(default)]
    profile: Option<KugouProfile>,
    /// 本地记录的已签到日期（`YYYY-MM-DD`，中国区）。
    /// 上游没有稳定的「签到日历」接口，日历打勾以本地记录为准，
    /// 与参考实现（`settings_signed_days_$userid`）做法一致。
    #[serde(default)]
    signed_days: Vec<String>,
}

static STATE: OnceLock<Mutex<KugouPersist>> = OnceLock::new();
static LOADED: AtomicBool = AtomicBool::new(false);

fn state() -> &'static Mutex<KugouPersist> {
    STATE.get_or_init(|| Mutex::new(KugouPersist::default()))
}

fn persist_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    Ok(dir.join(PERSIST_FILE))
}

/// 首次调用时载入落盘状态，并初始化酷狗设备身份（device_info.json）。
fn ensure_loaded(app: &tauri::AppHandle) {
    if LOADED.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&dir);
        // 设备身份由 kugou_server 自己维护；必须先登记目录，否则
        // /register/dev 拿到的 dfid 无法落盘，每次启动都会注册成新设备。
        kugou_server::bridge::init(&dir.to_string_lossy());
    }
    let loaded = persist_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<KugouPersist>(&s).ok())
        .unwrap_or_default();
    *state().lock().unwrap() = loaded;
}

/// 落盘（best-effort，失败不影响当前会话）
fn save_persist(app: &tauri::AppHandle) {
    let snapshot = state().lock().unwrap().clone();
    if let Ok(path) = persist_path(app) {
        if let Ok(text) = serde_json::to_string_pretty(&snapshot) {
            let _ = std::fs::write(path, text);
        }
    }
}

// ---- cookie jar ----

fn parse_cookie_jar(jar: &str) -> Vec<(String, String)> {
    jar.split(';')
        .filter_map(|pair| {
            let pair = pair.trim();
            let i = pair.find('=')?;
            let key = pair[..i].trim();
            if key.is_empty() {
                return None;
            }
            Some((key.to_string(), pair[i + 1..].trim().to_string()))
        })
        .collect()
}

fn jar_value(jar: &[(String, String)], key: &str) -> String {
    jar.iter()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

/// 把 bridge 返回的 cookie 合并进 jar（同键后写覆盖）
fn merge_cookies(pairs: &[String]) {
    let mut st = state().lock().unwrap();
    let mut list = parse_cookie_jar(&st.cookie);
    for raw in pairs {
        let Some(i) = raw.find('=') else {
            continue;
        };
        let key = raw[..i].trim();
        if key.is_empty() {
            continue;
        }
        let val = raw[i + 1..].trim().to_string();
        match list.iter().position(|(k, _)| k == key) {
            Some(idx) => list[idx].1 = val,
            None => list.push((key.to_string(), val)),
        }
    }
    st.cookie = list
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ");
}

/// 退出登录：只清账号凭据，保留设备身份 cookie（与参考实现一致）
fn clear_account_cookies() {
    const ACCOUNT_KEYS: [&str; 5] = ["token", "userid", "vip_token", "vip_type", "t1"];
    let mut st = state().lock().unwrap();
    let kept: Vec<(String, String)> = parse_cookie_jar(&st.cookie)
        .into_iter()
        .filter(|(k, _)| !ACCOUNT_KEYS.contains(&k.as_str()))
        .collect();
    st.cookie = kept
        .into_iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ");
    st.profile = None;
    st.signed_days.clear();
}

// ---- 调用内核 ----

/// 调用酷狗接口。
///
/// 响应 cookie 无论成败都合并进 jar——登录失败也可能带回新的设备 cookie。
/// HTTP 状态非 200 视为传输层失败（业务错误码在 body 里，由各命令自行判断）。
fn call_json(path: &str, params: Value) -> Result<Value, String> {
    let cookie = state().lock().unwrap().cookie.clone();
    let res = kugou_server::bridge::call(path, &params, &cookie);
    if !res.cookies.is_empty() {
        merge_cookies(&res.cookies);
    }
    if res.status != 200 {
        return Err(format!("酷狗接口请求失败（HTTP {}）", res.status));
    }
    serde_json::from_str(&res.body).map_err(|e| format!("酷狗响应解析失败：{e}"))
}

// ---- Value 取值辅助（容错：data 子对象优先，其次顶层；字符串/数字互转）----

fn pick_str(root: &Value, key: &str, default: &str) -> String {
    let holder = root.get("data").unwrap_or(root);
    for node in [holder, root] {
        if let Some(s) = node.get(key).and_then(Value::as_str) {
            if !s.is_empty() {
                return s.to_string();
            }
        }
        if let Some(n) = node.get(key).and_then(Value::as_i64) {
            return n.to_string();
        }
    }
    default.to_string()
}

fn pick_str_any(root: &Value, keys: &[&str], default: &str) -> String {
    for key in keys {
        let found = pick_str(root, key, "");
        if !found.is_empty() {
            return found;
        }
    }
    default.to_string()
}

fn pick_i64(root: &Value, key: &str, default: i64) -> i64 {
    let holder = root.get("data").unwrap_or(root);
    for node in [holder, root] {
        if let Some(n) = node.get(key).and_then(Value::as_i64) {
            return n;
        }
        if let Some(s) = node.get(key).and_then(Value::as_str) {
            if let Ok(n) = s.trim().parse::<i64>() {
                return n;
            }
        }
    }
    default
}

/// 上游业务错误文案：`error_msg` → `msg` → 兜底
fn err_msg(res: &Value, fallback: &str) -> String {
    let msg = pick_str_any(res, &["error_msg", "msg", "info"], "");
    if msg.is_empty() {
        fallback.to_string()
    } else {
        msg
    }
}

/// 上游成功判定：`status == 1` 或 `error_code == 0`
fn is_ok(res: &Value) -> bool {
    pick_i64(res, "status", 0) == 1 || pick_i64(res, "error_code", -1) == 0
}

fn local_now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Unix 秒 → 中国区日期 `YYYY-MM-DD`（酷狗按 UTC+8 判定签到日）
fn china_date(secs: i64) -> String {
    match FixedOffset::east_opt(8 * 3600).and_then(|tz| tz.timestamp_opt(secs, 0).single()) {
        Some(dt) => dt.format("%Y-%m-%d").to_string(),
        None => String::new(),
    }
}

/// 服务器当前时间（秒）。`/server/now` 失败时降级用本地时间，
/// 与参考实现一致（避免因取时间失败而无法签到）。
fn server_now_secs() -> i64 {
    match call_json("/server/now", json!({})) {
        Ok(res) => {
            let ts = pick_i64(&res, "timestamp", 0);
            if ts > 0 {
                ts
            } else {
                local_now_secs()
            }
        }
        Err(_) => local_now_secs(),
    }
}

// ---- 对外返回类型 ----

/// 登录态（不发网络请求）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KugouLoginStatus {
    pub logged_in: bool,
    pub profile: Option<KugouProfile>,
    /// 已签到日期（`YYYY-MM-DD`），供签到日历打勾
    pub signed_days: Vec<String>,
}

/// 扫码登录：二维码 key 与内容
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KugouQrKey {
    /// 轮询用 key
    pub key: String,
    /// 二维码内容；前端用 qrcode 库渲染成图片（与网易云登录同一路径，故不走 Rust 出图）
    pub url: String,
}

/// 扫码轮询结果
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KugouQrCheck {
    /// 1=等待扫码 2/803=已扫码待确认 4=登录成功 0/800=已过期
    pub status: i64,
    pub logged_in: bool,
    pub profile: Option<KugouProfile>,
}

/// 签到结果
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KugouSignInResult {
    pub ok: bool,
    pub message: String,
    /// 需要二次安全验证（error_code=20028）时返回，前端完成验证后重试
    pub ssa_code: Option<String>,
    /// 是否已升级为概念版（SVIP）
    pub svip: bool,
}

/// 播放地址解析结果
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KugouSongUrl {
    pub url: String,
    /// 实际命中的音质档位（128 / 320 / flac / high / ...）
    pub quality: String,
    /// 是否为试听片段（无版权 / 非会员时上游只给 30~60s 片段）
    pub trial: bool,
}

// ---- 账号 ----

/// 读取 `/user/detail` 并更新账号信息
fn fetch_profile() -> Result<KugouProfile, String> {
    let detail = call_json("/user/detail", json!({}))?;
    let jar = parse_cookie_jar(&state().lock().unwrap().cookie);
    let jar_userid: i64 = jar_value(&jar, "userid").trim().parse().unwrap_or(0);
    if !is_ok(&detail) && jar_userid == 0 {
        return Err(err_msg(&detail, "获取酷狗账号信息失败"));
    }
    Ok(KugouProfile {
        userid: pick_i64(&detail, "userid", jar_userid),
        nickname: pick_str_any(&detail, &["nickname", "username", "name"], ""),
        avatar: pick_str_any(&detail, &["avatar", "img", "pic"], ""),
        vip_type: jar_value(&jar, "vip_type").trim().parse().unwrap_or(0),
    })
}

/// 当前登录态（不发网络请求，供启动时恢复 UI）
#[tauri::command]
pub fn kugou_login_status(app: tauri::AppHandle) -> KugouLoginStatus {
    ensure_loaded(&app);
    let st = state().lock().unwrap();
    KugouLoginStatus {
        logged_in: st.profile.is_some(),
        profile: st.profile.clone(),
        signed_days: st.signed_days.clone(),
    }
}

/// 拉取二维码 key 与内容
#[tauri::command]
pub async fn kugou_login_qr_key(app: tauri::AppHandle) -> Result<KugouQrKey, String> {
    tauri::async_runtime::spawn_blocking(move || kugou_login_qr_key_sync(app))
        .await
        .map_err(|e| format!("酷狗请求异常：{e}"))?
}

fn kugou_login_qr_key_sync(app: tauri::AppHandle) -> Result<KugouQrKey, String> {
    ensure_loaded(&app);
    let res = call_json("/login/qr/key", json!({}))?;
    let key = pick_str(&res, "qrcode", "");
    if key.is_empty() {
        return Err(err_msg(&res, "获取酷狗登录二维码失败"));
    }
    let created = call_json("/login/qr/create", json!({ "key": key.clone() }))?;
    Ok(KugouQrKey {
        key,
        url: pick_str(&created, "url", ""),
    })
}

/// 轮询扫码状态；status=4 时写入凭据并拉取账号信息
#[tauri::command]
pub async fn kugou_login_qr_check(
    app: tauri::AppHandle,
    key: String,
) -> Result<KugouQrCheck, String> {
    tauri::async_runtime::spawn_blocking(move || kugou_login_qr_check_sync(app, key))
        .await
        .map_err(|e| format!("酷狗请求异常：{e}"))?
}

fn kugou_login_qr_check_sync(app: tauri::AppHandle, key: String) -> Result<KugouQrCheck, String> {
    ensure_loaded(&app);
    let res = call_json("/login/qr/check", json!({ "key": key }))?;
    let status = pick_i64(&res, "status", 1);
    if status != 4 {
        return Ok(KugouQrCheck {
            status,
            logged_in: false,
            profile: None,
        });
    }
    // status=4：bridge 已把 token/userid/vip_token 合并进 jar
    let profile = fetch_profile().ok();
    {
        let mut st = state().lock().unwrap();
        st.profile = profile.clone();
    }
    save_persist(&app);
    Ok(KugouQrCheck {
        status,
        logged_in: profile.is_some(),
        profile,
    })
}

/// 发送手机短信验证码
#[tauri::command]
pub async fn kugou_captcha_sent(app: tauri::AppHandle, mobile: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || kugou_captcha_sent_sync(app, mobile))
        .await
        .map_err(|e| format!("酷狗请求异常：{e}"))?
}

fn kugou_captcha_sent_sync(app: tauri::AppHandle, mobile: String) -> Result<(), String> {
    ensure_loaded(&app);
    let res = call_json("/captcha/sent", json!({ "mobile": mobile }))?;
    if is_ok(&res) {
        return Ok(());
    }
    Err(err_msg(&res, "验证码发送失败"))
}

/// 手机号 + 验证码登录
#[tauri::command]
pub async fn kugou_login_cellphone(
    app: tauri::AppHandle,
    mobile: String,
    code: String,
) -> Result<KugouProfile, String> {
    tauri::async_runtime::spawn_blocking(move || kugou_login_cellphone_sync(app, mobile, code))
        .await
        .map_err(|e| format!("酷狗请求异常：{e}"))?
}

fn kugou_login_cellphone_sync(
    app: tauri::AppHandle,
    mobile: String,
    code: String,
) -> Result<KugouProfile, String> {
    ensure_loaded(&app);
    let res = call_json(
        "/login/cellphone",
        json!({ "mobile": mobile, "code": code }),
    )?;
    if !is_ok(&res) {
        return Err(err_msg(&res, "手机号登录失败"));
    }
    let profile = fetch_profile()?;
    {
        let mut st = state().lock().unwrap();
        st.profile = Some(profile.clone());
    }
    save_persist(&app);
    Ok(profile)
}

/// 刷新账号信息
#[tauri::command]
pub async fn kugou_account(app: tauri::AppHandle) -> Result<KugouProfile, String> {
    tauri::async_runtime::spawn_blocking(move || kugou_account_sync(app))
        .await
        .map_err(|e| format!("酷狗请求异常：{e}"))?
}

fn kugou_account_sync(app: tauri::AppHandle) -> Result<KugouProfile, String> {
    ensure_loaded(&app);
    let profile = fetch_profile()?;
    {
        let mut st = state().lock().unwrap();
        st.profile = Some(profile.clone());
    }
    save_persist(&app);
    Ok(profile)
}

/// 退出登录（清 Rust 侧账号 cookie + 本地状态）
#[tauri::command]
pub fn kugou_logout(app: tauri::AppHandle) -> Result<(), String> {
    ensure_loaded(&app);
    clear_account_cookies();
    save_persist(&app);
    Ok(())
}

// ---- 签到 ----

/// 每日签到：领取畅听 VIP → 升级概念版（SVIP）。
///
/// 对齐参考实现的双签到语义：
/// - `131001` = 今日已领取畅听 VIP（不阻断升级步骤）；
/// - `20030` = 已升级过概念版（视为成功）；
/// - `20028` = 需二次安全验证，返回 `ssa_code` 由前端验证后重试。
#[tauri::command]
pub async fn kugou_sign_in(app: tauri::AppHandle) -> Result<KugouSignInResult, String> {
    tauri::async_runtime::spawn_blocking(move || kugou_sign_in_sync(app))
        .await
        .map_err(|e| format!("酷狗签到异常：{e}"))?
}

fn kugou_sign_in_sync(app: tauri::AppHandle) -> Result<KugouSignInResult, String> {
    ensure_loaded(&app);
    if state().lock().unwrap().profile.is_none() {
        return Err("请先登录酷狗账号".to_string());
    }
    let receive_day = china_date(server_now_secs());
    if receive_day.is_empty() {
        return Err("无法确定签到日期，请稍后重试".to_string());
    }

    // 第一步：领取畅听 VIP（必传 receive_day，否则上游可能判为无效签到）
    let claim = call_json(
        "/youth/day/vip",
        json!({ "receive_day": receive_day.clone() }),
    )?;
    let claim_err = pick_i64(&claim, "error_code", -1);
    let claim_ok = is_ok(&claim) || claim_err == 131001;
    if !claim_ok {
        if claim_err == 20028 {
            let ssa = pick_str(&claim, "ssaCode", "");
            if !ssa.is_empty() {
                return Ok(KugouSignInResult {
                    ok: false,
                    message: String::new(),
                    ssa_code: Some(ssa),
                    svip: false,
                });
            }
        }
        return Ok(KugouSignInResult {
            ok: false,
            message: err_msg(&claim, "签到失败"),
            ssa_code: None,
            svip: false,
        });
    }

    // 第二步：升级概念版（完整）会员——必须严格判断，不能静默吞掉失败，
    // 否则会出现「提示签到成功但官方只加了畅听 VIP」的假成功。
    let upgrade = call_json("/youth/day/vip/upgrade", json!({}));
    let (upgraded, upgrade_msg) = match upgrade {
        Ok(res) => {
            let err = pick_i64(&res, "error_code", -1);
            let done = err == 20030 || err == 131001;
            let ok = is_ok(&res) || done;
            if !ok && err == 20028 {
                let ssa = pick_str(&res, "ssaCode", "");
                if !ssa.is_empty() {
                    return Ok(KugouSignInResult {
                        ok: false,
                        message: String::new(),
                        ssa_code: Some(ssa),
                        svip: false,
                    });
                }
            }
            (ok, err_msg(&res, ""))
        }
        // 网络层异常：不标记成功，按升级失败处理
        Err(e) => (false, e),
    };

    if upgraded {
        {
            let mut st = state().lock().unwrap();
            if !st.signed_days.contains(&receive_day) {
                st.signed_days.push(receive_day);
            }
        }
        save_persist(&app);
        return Ok(KugouSignInResult {
            ok: true,
            message: "签到成功（概念版会员）".to_string(),
            ssa_code: None,
            svip: true,
        });
    }

    Ok(KugouSignInResult {
        ok: false,
        message: if upgrade_msg.is_empty() {
            "畅听 VIP 已领取，但概念版升级未成功".to_string()
        } else {
            format!("概念版升级未成功：{upgrade_msg}")
        },
        ssa_code: None,
        svip: false,
    })
}

// ---- 音乐解析 ----

/// 默认音质档位。`/song/url` 的 quality 是字符串（128/320/flac/high/...）。
const DEFAULT_QUALITY: &str = "128";

/// 解析播放地址。`album_audio_id` / `album_id` 可选（部分歌曲缺它们取不到高音质）。
#[tauri::command]
pub async fn kugou_song_url(
    app: tauri::AppHandle,
    hash: String,
    album_audio_id: Option<String>,
    album_id: Option<String>,
    quality: Option<String>,
) -> Result<KugouSongUrl, String> {
    tauri::async_runtime::spawn_blocking(move || {
        kugou_song_url_sync(app, hash, album_audio_id, album_id, quality)
    })
    .await
    .map_err(|e| format!("酷狗请求异常：{e}"))?
}

/// 一次播放地址命中的结果
struct PlayHit {
    url: String,
    quality: String,
    trial: bool,
}

impl From<PlayHit> for KugouSongUrl {
    fn from(hit: PlayHit) -> Self {
        KugouSongUrl {
            url: hit.url,
            quality: hit.quality,
            trial: hit.trial,
        }
    }
}

fn kugou_song_url_sync(
    app: tauri::AppHandle,
    hash: String,
    album_audio_id: Option<String>,
    album_id: Option<String>,
    quality: Option<String>,
) -> Result<KugouSongUrl, String> {
    ensure_loaded(&app);
    // 上游按小写 hash 索引（参考实现的 getSongUrl 也是先 toLowerCase）
    let hash = hash.trim().to_ascii_lowercase();
    if hash.is_empty() {
        return Err("缺少歌曲 hash，无法解析播放地址".to_string());
    }
    let quality = match quality.as_deref() {
        Some(q) if !q.is_empty() => q.to_string(),
        _ => DEFAULT_QUALITY.to_string(),
    };

    let mut errors: Vec<String> = Vec::new();

    // 接口顺序对齐参考实现的 getSongUrl：
    //   /song/url      → trackercdn v5/url，普通路径，登录与否都能用；
    //   /song/url/new  → tracker v6/priv_url，服务端要读 cookie 里的 vip_token
    //                    才认 VIP，没有 VIP 凭证时常常直接给不出链接。
    // 之前的实现只调了后者，普通账号必然全军覆没——这就是实机上「该歌曲暂无
    // 可用播放地址」的根因。
    for path in ["/song/url", "/song/url/new"] {
        match call_json(
            path,
            url_params(&hash, &album_audio_id, &album_id, &quality, false),
        ) {
            Ok(res) => {
                if let Some(hit) = extract_play(&data_node(&res), &quality) {
                    // fail_process 含 buy 且请求的不是标准音质 ⇒ 上游给的是试听片段，
                    // 降级到标准音质重取一次（音频本身可播，但只有前一小段）
                    if hit.trial && quality != DEFAULT_QUALITY {
                        let fallback =
                            url_params(&hash, &album_audio_id, &album_id, DEFAULT_QUALITY, false);
                        if let Ok(fb) = call_json(path, fallback) {
                            if let Some(fb_hit) = extract_play(&data_node(&fb), DEFAULT_QUALITY) {
                                return Ok(fb_hit.into());
                            }
                        }
                    }
                    return Ok(hit.into());
                }
            }
            Err(e) => errors.push(e),
        }
    }

    // 试听兜底：未登录 / 无版权时只有 free_part=1 才回 30~60s 片段。
    // 能播一小段总好过完全播不了，但要如实标记 trial。
    let free_params = url_params(&hash, &album_audio_id, &album_id, DEFAULT_QUALITY, true);
    if let Ok(free) = call_json("/song/url", free_params) {
        if let Some(hit) = extract_play(&data_node(&free), DEFAULT_QUALITY) {
            return Ok(hit.into());
        }
    }

    // 接口层本身就失败了（网络 / 风控）就如实回报第一个错误，
    // 别笼统说成「无版权」，否则排查时会被误导。
    match errors.into_iter().next() {
        Some(e) => Err(e),
        None => Err("该歌曲暂无可用播放地址（可能无版权或需要会员）".to_string()),
    }
}

/// 播放地址请求参数。`free_part` 为 true 时向接口索取试听片段。
fn url_params(
    hash: &str,
    album_audio_id: &Option<String>,
    album_id: &Option<String>,
    quality: &str,
    free_part: bool,
) -> Value {
    let mut params = json!({ "hash": hash, "quality": quality });
    if let Some(obj) = params.as_object_mut() {
        // 这两个 id 上游用 q_num 读，字符串数字也能解析
        if let Some(id) = album_audio_id.as_deref().filter(|s| !s.is_empty()) {
            obj.insert("album_audio_id".to_string(), json!(id));
        }
        if let Some(id) = album_id.as_deref().filter(|s| !s.is_empty()) {
            obj.insert("album_id".to_string(), json!(id));
        }
        if free_part {
            obj.insert("free_part".to_string(), json!(1));
        }
    }
    params
}

/// 取响应的 data 层（可能没有 data、也可能是数组，统一取首个对象）
fn data_node(res: &Value) -> Value {
    match res.get("data") {
        Some(Value::Array(items)) => items.first().cloned().unwrap_or(Value::Null),
        Some(other) => other.clone(),
        None => res.clone(),
    }
}

/// 从播放地址响应里取出可用链接。
/// 返回 (url, 实际音质, 是否试听片段)；没有 url 时返回 None。
fn extract_play(node: &Value, requested: &str) -> Option<PlayHit> {
    let url = match node.get("url") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .find_map(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    };
    if url.is_empty() {
        return None;
    }
    // fail_process 含 "buy" ⇒ 该音质需要购买/会员，返回的 URL 实为试听片段，
    // 不能当作完整音源使用
    let trial = node
        .get("fail_process")
        .and_then(Value::as_array)
        .map(|a| a.iter().any(|v| v.as_str() == Some("buy")))
        .unwrap_or(false);
    Some(PlayHit {
        url,
        quality: node
            .get("quality")
            .and_then(Value::as_str)
            .unwrap_or(requested)
            .to_string(),
        trial,
    })
}

// ---- 封面代理 ----

/// 允许代理的图床域名后缀。该命令只用于绕开 WebView 的 CORS 限制，
/// 加白名单避免它被当成任意 URL 的通用代理使用。
const KUGOU_IMAGE_HOST_SUFFIXES: [&str; 3] = ["kugou.com", "kgimg.com", "kglink.com"];

fn is_allowed_image_url(url: &str) -> bool {
    let Some(rest) = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
    else {
        return false;
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .rsplit('@')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if host.is_empty() {
        return false;
    }
    KUGOU_IMAGE_HOST_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}

/// 取酷狗封面并以 dataURL 返回。
///
/// 为什么需要它：`imge.kugou.com` 不返回 `Access-Control-Allow-Origin`，
/// WebView 里 `fetch()` 会被同源策略直接拦掉（表现为 `[封面缓存] 获取失败`
/// 加上 `net::ERR_FAILED`）。改由 Rust 侧取字节，前端拿到 dataURL 直接当
/// `src` 用；IndexedDB 缓存键仍是原始 URL，缓存行为不变。
///
/// 顺带处理图床前缀不一致：上游会给搜索结果的封面返回
/// `imge.kugou.com/mcommon/{size}/…`，但实测同一文件在该前缀下 404、
/// 在 `stdmusic/{size}/…` 下 200（见 stdmusic_variant 的说明）。
#[tauri::command]
pub async fn kugou_cover(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || kugou_cover_sync(&url))
        .await
        .map_err(|e| format!("酷狗封面请求异常：{e}"))?
}

fn kugou_cover_sync(url: &str) -> Result<String, String> {
    if !is_allowed_image_url(url) {
        return Err("不支持的图片地址".to_string());
    }
    let mut candidates = vec![url.to_string()];
    if let Some(alt) = stdmusic_variant(url) {
        candidates.push(alt);
    }

    let mut last_err = String::new();
    for candidate in candidates {
        match fetch_image_data_url(&candidate) {
            Ok(data) => return Ok(data),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

/// 备用图床前缀：把路径首段换成 `stdmusic`。
///
/// 上游搜索接口返回的封面常形如 `…/mcommon/{size}/20241211/xxx.jpg`，
/// 但实测该前缀取不到图（HTTP 404，CDN 只回默认占位图），而把首段换成
/// `stdmusic` 后**同一张图**返回 200。两类前缀都接受 `{size}` 字面量，
/// 所以只改前缀、其余原样保留；已是 stdmusic 或路径过短时返回 None。
fn stdmusic_variant(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let (host, path) = rest.split_once('/')?;
    let mut segments: Vec<&str> = path.split('/').collect();
    if segments.len() < 2 || segments.first() == Some(&"stdmusic") {
        return None;
    }
    segments[0] = "stdmusic";
    Some(format!("{scheme}://{host}/{}", segments.join("/")))
}

/// 取单张图并转 dataURL
fn fetch_image_data_url(url: &str) -> Result<String, String> {
    let resp = image_client()
        .get(url)
        .header(reqwest::header::REFERER, "https://www.kugou.com/")
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        )
        .send()
        .map_err(|e| format!("封面请求失败：{e}"))?;
    let status = resp.status().as_u16();
    if !(200..=299).contains(&status) {
        return Err(format!("封面返回 HTTP {status}"));
    }
    let mime = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.starts_with("image/"))
        .unwrap_or("image/jpeg")
        .to_string();
    let bytes = resp.bytes().map_err(|e| format!("封面读取失败：{e}"))?;
    // 缺图时 CDN 也回 2xx + 极小占位图的情况兜一下
    if bytes.len() < 512 {
        return Err(format!("封面响应过小（{} 字节）", bytes.len()));
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// 封面代理专用客户端（带超时，避免图床卡住把命令一直挂着）
fn image_client() -> &'static reqwest::blocking::Client {
    static C: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("构建封面 HTTP 客户端失败")
    })
}

// ---- 在线数据（列表类返回原始 JSON，归一化见 src/utils/kugou.ts）----

/// 关键词搜索
#[tauri::command]
pub async fn kugou_search(
    app: tauri::AppHandle,
    keyword: String,
    page: Option<i64>,
    pagesize: Option<i64>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_loaded(&app);
        call_json(
            "/search",
            json!({
                "keyword": keyword,
                "page": page.unwrap_or(1),
                "pagesize": pagesize.unwrap_or(30),
            }),
        )
    })
    .await
    .map_err(|e| format!("酷狗请求异常：{e}"))?
}

/// 歌单详情
#[tauri::command]
pub async fn kugou_playlist_detail(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_loaded(&app);
        call_json("/playlist/detail", json!({ "id": id }))
    })
    .await
    .map_err(|e| format!("酷狗请求异常：{e}"))?
}

/// 排行榜列表
#[tauri::command]
pub async fn kugou_rank_list(app: tauri::AppHandle, zone: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_loaded(&app);
        match zone {
            Some(z) if !z.is_empty() => call_json("/rank/list", json!({ "zone": z })),
            _ => call_json("/rank/list", json!({})),
        }
    })
    .await
    .map_err(|e| format!("酷狗请求异常：{e}"))?
}

/// 排行榜歌曲
#[tauri::command]
pub async fn kugou_rank_songs(
    app: tauri::AppHandle,
    rank_cid: String,
    page: Option<i64>,
    pagesize: Option<i64>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_loaded(&app);
        call_json(
            "/rank/audio",
            json!({
                "rank_cid": rank_cid,
                "page": page.unwrap_or(1),
                "pagesize": pagesize.unwrap_or(30),
            }),
        )
    })
    .await
    .map_err(|e| format!("酷狗请求异常：{e}"))?
}

/// 每日推荐
#[tauri::command]
pub async fn kugou_everyday_recommend(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_loaded(&app);
        call_json("/everyday/recommend", json!({}))
    })
    .await
    .map_err(|e| format!("酷狗请求异常：{e}"))?
}
