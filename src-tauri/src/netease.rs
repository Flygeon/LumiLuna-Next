//! 网易云音乐账号模块：扫码登录 / 账号信息 / 我的歌单 / 云盘歌曲 / 播放 URL。
//!
//! 签名算法（weapi / eapi）与请求特征移植自 api-enhanced 项目
//! （https://github.com/neteasecloudmusicapienhanced/api-enhanced，MIT）：
//! - weapi：双层 AES-128-CBC（presetKey + 随机 secretKey）+ RSA-1024 PKCS1v15
//! - eapi：MD5 拼接 + AES-128-ECB（hex 大写输出）
//! 请求与 cookie 全部在 Rust 侧：MUSIC_U 等凭据不进入 WebView；
//! cookie 持久化在 app data 目录，重启后自动恢复登录态。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use aes::Aes128;
use base64::Engine;
use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use ecb::cipher::KeyInit;
use md5::{Digest, Md5};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use rsa::pkcs1::DecodeRsaPublicKey;
use rsa::{Pkcs1v15Encrypt, RsaPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

// ---- 常量（移植自 api-enhanced util/crypto.js + util/config.json）----

const PRESET_KEY: &[u8; 16] = b"0CoJUm6Qyw8W8jud";
const IV: &[u8; 16] = b"0102030405060708";
const EAPI_KEY: &[u8; 16] = b"e82ckenh8dichen8";
const BASE62: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";

const RSA_PUBLIC_KEY_PEM: &str = "-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ37BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvaklV8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44oncaTWz7OBGLbCiK45wIDAQAB
-----END PUBLIC KEY-----";

// 请求特征（参考 util/request.js userAgentMap / osMap）
const UA_EAPI: &str = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";
const UA_WEAPI: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const OS_OSVER: &str = "Microsoft-Windows-10-Professional-build-19045-64bit";
const OS_APPVER: &str = "3.1.17.204416";
const OS_CHANNEL: &str = "netease";
const OS_NAME: &str = "pc";
const DOMAIN: &str = "https://music.163.com";

/// cookie / 设备指纹持久化文件名（app data 目录）
const PERSIST_FILE: &str = "netease.json";

// ---- 持久化状态 ----

/// 落盘数据：cookie（k=v; k=v; ...）+ 设备指纹 + 登录账号缓存
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct NeteasePersist {
    cookie: String,
    device_id: String,
    uid: Option<i64>,
    profile: Option<NeteaseAccount>,
}

static STATE: OnceLock<Mutex<NeteasePersist>> = OnceLock::new();

fn state() -> &'static Mutex<NeteasePersist> {
    STATE.get_or_init(|| Mutex::new(NeteasePersist::default()))
}

fn persist_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败：{e}"))?;
    Ok(dir.join(PERSIST_FILE))
}

fn load_persist(app: &tauri::AppHandle) -> NeteasePersist {
    let Ok(path) = persist_path(app) else {
        return NeteasePersist::default();
    };
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<NeteasePersist>(&s).ok())
        .unwrap_or_default()
}

fn save_persist(app: &tauri::AppHandle, p: &NeteasePersist) -> Result<(), String> {
    let path = persist_path(app)?;
    let json = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| format!("保存网易云登录态失败：{e}"))
}

fn clear_persist(app: &tauri::AppHandle) {
    *state().lock().unwrap() = NeteasePersist::default();
    if let Ok(path) = persist_path(app) {
        let _ = std::fs::remove_file(path);
    }
}

// ---- 共享 HTTP 客户端 ----

static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

fn client() -> &'static reqwest::blocking::Client {
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .build()
            .expect("netease http client")
    })
}

// ---- 随机工具 ----

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    let _ = getrandom::getrandom(&mut buf);
    buf
}

fn random_hex(n: usize) -> String {
    random_bytes(n).iter().map(|b| format!("{b:02x}")).collect()
}

fn random_from(alphabet: &[u8], n: usize) -> String {
    random_bytes(n)
        .iter()
        .map(|b| alphabet[(b % alphabet.len() as u8) as usize] as char)
        .collect()
}

fn random_base62(n: usize) -> String {
    random_from(BASE62, n)
}

fn random_alpha(n: usize) -> String {
    random_from(LOWER, n)
}

/// 52 位 hex 设备指纹（参考 generateDeviceId，持久化复用）
fn generate_device_id() -> String {
    random_hex(52)
}

// ---- 加密（移植自 api-enhanced util/crypto.js）----

fn aes_cbc_b64(key: &[u8], iv: &[u8; 16], plain: &str) -> String {
    type Aes128CbcEnc = cbc::Encryptor<Aes128>;
    let enc = Aes128CbcEnc::new(key.into(), iv.into());
    // encrypt_padded_vec_mut 需要 cipher 的 alloc feature，这里手动给 buffer
    let msg = plain.as_bytes();
    let mut buf = vec![0u8; msg.len() + 16];
    let ct = enc
        .encrypt_padded_mut::<Pkcs7>(&mut buf, msg.len())
        .expect("aes cbc padding");
    base64::engine::general_purpose::STANDARD.encode(ct)
}

/// AES-128-ECB（PKCS7 填充），输出大写 hex（参考 aesEncrypt format='hex'）
fn aes_ecb_hex(key: &[u8; 16], plain: &str) -> String {
    // ecb::Encryptor 实现 BlockEncryptMut（原地加密）
    use ecb::cipher::BlockEncryptMut as _;
    let mut cipher = ecb::Encryptor::<Aes128>::new(key.into());
    let mut bytes = plain.as_bytes().to_vec();
    let pad = 16 - (bytes.len() % 16);
    bytes.extend(std::iter::repeat_n(pad as u8, pad));
    let mut out = String::with_capacity(bytes.len() * 2);
    for chunk in bytes.chunks_exact(16) {
        let mut block = aes::Block::clone_from_slice(chunk);
        cipher.encrypt_block_mut(&mut block);
        for b in block.iter() {
            out.push_str(&format!("{b:02X}"));
        }
    }
    out
}

/// RSA-1024 PKCS1v15 加密（参考 rsaEncrypt，小写 hex 输出）
fn rsa_encrypt_hex(data: &[u8]) -> String {
    let key = RsaPublicKey::from_pkcs1_pem(RSA_PUBLIC_KEY_PEM).expect("netease rsa pubkey");
    let mut rng = rsa::rand_core::OsRng;
    let ct = key
        .encrypt(&mut rng, Pkcs1v15Encrypt, data)
        .expect("netease rsa encrypt");
    ct.iter().map(|b| format!("{b:02x}")).collect()
}

/// weapi 加密：双层 AES-CBC + RSA（返回 (params, encSecKey)）
fn weapi(data: &Value) -> (String, String) {
    let text = data.to_string();
    let secret = random_base62(16);
    let inner = aes_cbc_b64(secret.as_bytes(), IV, &text);
    let params = aes_cbc_b64(PRESET_KEY, IV, &inner);
    let reversed: String = secret.chars().rev().collect();
    let enc_sec_key = rsa_encrypt_hex(reversed.as_bytes());
    (params, enc_sec_key)
}

/// eapi 加密：MD5 + AES-ECB，返回大写 hex params
fn eapi(path: &str, data: &Value) -> String {
    let text = data.to_string();
    let digest = format!(
        "{:x}",
        Md5::digest(format!("nobody{path}use{text}md5forencrypt").as_bytes())
    );
    let plain = format!("{path}-36cd479b6b5-{text}-36cd479b6b5-{digest}");
    aes_ecb_hex(EAPI_KEY, &plain)
}

// ---- cookie 工具（参考 util/index.js）----

fn cookie_to_map(cookie: &str) -> HashMap<String, String> {
    let mut m = HashMap::new();
    for item in cookie.split(';') {
        if let Some((k, v)) = item.trim().split_once('=') {
            m.insert(k.trim().to_string(), v.trim().to_string());
        }
    }
    m
}

/// encodeURIComponent 等价编码集
const URI_COMPONENT: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'$')
    .add(b'%')
    .add(b'&')
    .add(b'+')
    .add(b',')
    .add(b'/')
    .add(b':')
    .add(b';')
    .add(b'<')
    .add(b'=')
    .add(b'>')
    .add(b'?')
    .add(b'@')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');

fn encode_uri_component(s: &str) -> String {
    utf8_percent_encode(s, URI_COMPONENT).to_string()
}

fn map_to_cookie(m: &HashMap<String, String>) -> String {
    let mut parts = Vec::with_capacity(m.len());
    for (k, v) in m {
        parts.push(format!(
            "{}={}",
            encode_uri_component(k),
            encode_uri_component(v)
        ));
    }
    parts.join("; ")
}

/// weapi 请求的 Cookie 头（processCookieObject + cookieObjToString 的等价实现）
fn build_weapi_cookie(
    map: &HashMap<String, String>,
    device_id: &str,
    uri: &str,
) -> String {
    let mut m = map.clone();
    m.insert("__remember_me".into(), "true".into());
    m.insert("ntes_kaola_ad".into(), "1".into());
    let nuid = m
        .get("_ntes_nuid")
        .cloned()
        .unwrap_or_else(|| random_hex(32));
    m.insert("_ntes_nuid".into(), nuid.clone());
    m.entry("_ntes_nnid".into())
        .or_insert_with(|| format!("{nuid},{}", now_millis()));
    m.entry("WNMCID".into())
        .or_insert_with(|| format!("{}.{}.01.0", random_alpha(6), now_millis()));
    m.entry("WEVNSM".into())
        .or_insert_with(|| "1.0.0".into());
    m.entry("osver".into())
        .or_insert_with(|| OS_OSVER.into());
    m.entry("deviceId".into())
        .or_insert_with(|| device_id.into());
    m.entry("os".into()).or_insert_with(|| OS_NAME.into());
    m.entry("channel".into())
        .or_insert_with(|| OS_CHANNEL.into());
    m.entry("appver".into())
        .or_insert_with(|| OS_APPVER.into());
    if !uri.contains("login") {
        m.entry("NMTID".into()).or_insert_with(|| random_hex(32));
    }
    map_to_cookie(&m)
}

/// eapi 请求的 Cookie 头（createHeaderCookie 的等价实现：header 字段全量拼接）
fn build_eapi_cookie(header: &Value) -> String {
    let mut parts = Vec::new();
    if let Some(obj) = header.as_object() {
        for (k, v) in obj {
            let val = v.as_str().unwrap_or("");
            parts.push(format!(
                "{}={}",
                encode_uri_component(k),
                encode_uri_component(val)
            ));
        }
    }
    parts.join("; ")
}

// ---- 请求内核 ----

fn err_for_code(code: i64) -> String {
    match code {
        301 => "登录已过期，请重新扫码登录".to_string(),
        460 | 461 => "触发网易云风控，请稍后再试".to_string(),
        509 => "请先登录".to_string(),
        _ => format!("网易云返回错误（code={code}）"),
    }
}

/// 合并响应 Set-Cookie 到持久化 cookie 字符串
fn merge_set_cookie(persist: &mut NeteasePersist, resp: &reqwest::blocking::Response) {
    let mut m = cookie_to_map(&persist.cookie);
    for h in resp.headers().get_all("set-cookie") {
        if let Ok(v) = h.to_str() {
            if let Some((kv, _rest)) = v.split_once(';') {
                if let Some((k, val)) = kv.trim().split_once('=') {
                    m.insert(k.trim().to_string(), val.trim().to_string());
                }
            }
        }
    }
    persist.cookie = map_to_cookie(&m);
}

/// 统一请求入口：加密 → POST → 合并 cookie → 返回 (body.code, body)
fn api_call(crypto: &str, path: &str, data: &mut Value) -> Result<(i64, Value), String> {
    let mut persist = state().lock().map_err(|e| e.to_string())?;
    let cookie_map = cookie_to_map(&persist.cookie);
    let csrf = cookie_map.get("__csrf").cloned().unwrap_or_default();
    let music_u = cookie_map.get("MUSIC_U").cloned().unwrap_or_default();
    let music_a = cookie_map.get("MUSIC_A").cloned().unwrap_or_default();
    let device_id = if persist.device_id.is_empty() {
        let d = generate_device_id();
        persist.device_id = d.clone();
        d
    } else {
        persist.device_id.clone()
    };

    let (body, url, headers): (String, String, Vec<(String, String)>) =
        if crypto == "weapi" {
            data["csrf_token"] = Value::String(csrf.clone());
            let (params, enc_sec_key) = weapi(data);
            let body = format!(
                "params={}&encSecKey={}",
                encode_uri_component(&params),
                encode_uri_component(&enc_sec_key)
            );
            let url = format!("{DOMAIN}/weapi/{}", path.trim_start_matches("/api"));
            let cookie = build_weapi_cookie(&cookie_map, &device_id, path);
            (
                body,
                url,
                vec![
                    ("User-Agent".to_string(), UA_WEAPI.to_string()),
                    ("Referer".to_string(), DOMAIN.to_string()),
                    ("Cookie".to_string(), cookie),
                ],
            )
        } else {
            // eapi
            let ts = now_millis();
            let request_id = format!("{ts}_{:04}", rand4());
            let buildver = ts.to_string()[..10].to_string();
            let mut header = serde_json::json!({
                "osver": OS_OSVER,
                "deviceId": device_id,
                "os": OS_NAME,
                "appver": OS_APPVER,
                "versioncode": "140",
                "mobilename": "",
                "buildver": buildver,
                "resolution": "1920x1080",
                "__csrf": csrf,
                "channel": OS_CHANNEL,
                "requestId": request_id,
            });
            if !music_u.is_empty() {
                header["MUSIC_U"] = Value::String(music_u.clone());
            }
            if !music_a.is_empty() {
                header["MUSIC_A"] = Value::String(music_a.clone());
            }
            data["header"] = header.clone();
            let params = eapi(path, data);
            let body = format!("params={}", encode_uri_component(&params));
            let url = format!("{DOMAIN}/eapi/{}", path.trim_start_matches("/api"));
            let cookie = build_eapi_cookie(&header);
            (
                body,
                url,
                vec![
                    ("User-Agent".to_string(), UA_EAPI.to_string()),
                    ("Cookie".to_string(), cookie),
                ],
            )
        };
    drop(persist);

    let mut req = client().post(&url).body(body).timeout(Duration::from_secs(30));
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req.send().map_err(|e| format!("无法连接网易云：{e}"))?;

    // 合并 Set-Cookie（登录成功的关键：MUSIC_U 等）
    {
        let mut persist = state().lock().map_err(|e| e.to_string())?;
        merge_set_cookie(&mut persist, &resp);
    }

    let text = resp.text().map_err(|e| format!("读取网易云响应失败：{e}"))?;
    let body: Value =
        serde_json::from_str(&text).map_err(|_| format!("网易云响应解析失败：{}", &text[..text.len().min(120)]))?;
    let code = body["code"].as_i64().unwrap_or(0);
    Ok((code, body))
}

fn rand4() -> u32 {
    let b = random_bytes(2);
    u32::from(b[0]) * 256 + u32::from(b[1])
}

// ---- 账号信息 ----

fn fetch_account(app: &tauri::AppHandle) -> Result<NeteaseAccount, String> {
    let (code, body) = api_call(
        "weapi",
        "/api/w/nuser/account/get",
        &mut serde_json::json!({}),
    )?;
    if code != 200 {
        return Err(err_for_code(code));
    }
    let profile = &body["profile"];
    Ok(NeteaseAccount {
        user_id: body["account"]["id"]
            .as_i64()
            .or_else(|| profile["userId"].as_i64())
            .unwrap_or(0),
        nickname: profile["nickname"].as_str().unwrap_or("").to_string(),
        avatar_url: profile["avatarUrl"].as_str().unwrap_or("").to_string(),
    })
}

fn current_uid(app: &tauri::AppHandle) -> Result<i64, String> {
    let uid = state().lock().unwrap().uid;
    if let Some(uid) = uid {
        return Ok(uid);
    }
    let account = fetch_account(app)?;
    state().lock().unwrap().uid = Some(account.user_id);
    Ok(account.user_id)
}

// ---- 返回类型（与前端 TS 一一对应）----

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseAccount {
    pub user_id: i64,
    pub nickname: String,
    pub avatar_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseQrCheck {
    pub code: i64,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NeteasePlaylist {
    pub id: i64,
    pub name: String,
    pub cover_url: String,
    pub track_count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseSong {
    pub id: i64,
    pub name: String,
    pub artist: String,
    pub album: Option<String>,
    pub pic_url: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseCloudPage {
    pub songs: Vec<NeteaseSong>,
    pub has_more: bool,
    pub count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NeteaseSongUrl {
    pub id: i64,
    pub url: String,
}

// ---- Tauri 命令 ----

/// 获取二维码 key（unikey），前端据此渲染二维码
#[tauri::command]
pub fn netease_login_qr_key(app: tauri::AppHandle) -> Result<String, String> {
    // 启动时恢复持久化状态（仅首次）
    ensure_loaded(&app);
    let (code, body) = api_call(
        "eapi",
        "/api/login/qrcode/unikey",
        &mut serde_json::json!({ "type": 3 }),
    )?;
    if code != 200 {
        return Err(err_for_code(code));
    }
    let unikey = body["data"]["unikey"].as_str().unwrap_or_default().to_string();
    if unikey.is_empty() {
        return Err("未获取到登录二维码".into());
    }
    Ok(unikey)
}

/// 轮询扫码状态：800 等待 / 801 已扫码 / 802 确认中 / 803 登录成功
#[tauri::command]
pub fn netease_login_qr_check(
    app: tauri::AppHandle,
    key: String,
) -> Result<NeteaseQrCheck, String> {
    let (code, _body) = api_call(
        "eapi",
        "/api/login/qrcode/client/login",
        &mut serde_json::json!({ "key": key, "type": 3 }),
    )?;
    if code == 803 {
        // 登录成功：持久化 cookie，拉取账号信息
        {
            let persist = state().lock().unwrap();
            save_persist(&app, &persist)?;
        }
        let account = fetch_account(&app)?;
        {
            let mut persist = state().lock().unwrap();
            persist.uid = Some(account.user_id);
            persist.profile = Some(account.clone());
            save_persist(&app, &persist)?;
        }
        Ok(NeteaseQrCheck {
            code: 803,
            nickname: Some(account.nickname),
            avatar_url: Some(account.avatar_url),
        })
    } else {
        Ok(NeteaseQrCheck {
            code,
            nickname: None,
            avatar_url: None,
        })
    }
}

/// 账号信息（启动校验登录态；已过期则清除并报错）
#[tauri::command]
pub fn netease_account(app: tauri::AppHandle) -> Result<NeteaseAccount, String> {
    ensure_loaded(&app);
    match fetch_account(&app) {
        Ok(account) => {
            let mut persist = state().lock().unwrap();
            persist.uid = Some(account.user_id);
            persist.profile = Some(account.clone());
            Ok(account)
        }
        Err(e) => {
            if e.contains("登录已过期") || e.contains("请先登录") {
                clear_persist(&app);
            }
            Err(e)
        }
    }
}

/// 我的歌单（分页）
#[tauri::command]
pub fn netease_user_playlists(
    app: tauri::AppHandle,
    offset: i64,
    limit: i64,
) -> Result<Vec<NeteasePlaylist>, String> {
    let uid = current_uid(&app)?;
    let (code, body) = api_call(
        "weapi",
        "/api/user/playlist",
        &mut serde_json::json!({
            "uid": uid,
            "limit": limit,
            "offset": offset,
            "includeVideo": true,
        }),
    )?;
    if code != 200 {
        return Err(err_for_code(code));
    }
    let playlists = body["playlist"].as_array().cloned().unwrap_or_default();
    Ok(playlists
        .iter()
        .filter_map(|p| {
            Some(NeteasePlaylist {
                id: p["id"].as_i64()?,
                name: p["name"].as_str().unwrap_or("").to_string(),
                cover_url: p["coverImgUrl"].as_str().unwrap_or("").to_string(),
                track_count: p["trackCount"].as_i64().unwrap_or(0),
            })
        })
        .collect())
}

/// 歌单详情 → 歌曲列表
#[tauri::command]
pub fn netease_playlist_detail(
    app: tauri::AppHandle,
    id: i64,
) -> Result<Vec<NeteaseSong>, String> {
    let (code, body) = api_call(
        "eapi",
        "/api/v6/playlist/detail",
        &mut serde_json::json!({ "id": id, "n": 100000, "s": 8 }),
    )?;
    if code != 200 {
        return Err(err_for_code(code));
    }
    let tracks = body["playlist"]["tracks"].as_array().cloned().unwrap_or_default();
    Ok(songs_from_tracks(&tracks))
}

fn songs_from_tracks(tracks: &[Value]) -> Vec<NeteaseSong> {
    tracks
        .iter()
        .filter_map(|t| {
            let id = t["id"].as_i64()?;
            let artist = t["ar"]
                .as_array()
                .map(|ars| {
                    ars.iter()
                        .filter_map(|a| a["name"].as_str())
                        .collect::<Vec<_>>()
                        .join("/")
                })
                .unwrap_or_default();
            Some(NeteaseSong {
                id,
                name: t["name"].as_str().unwrap_or("").to_string(),
                artist,
                album: t["al"]["name"].as_str().map(|s| s.to_string()),
                pic_url: t["al"]["picUrl"].as_str().map(|s| s.to_string()),
            })
        })
        .collect()
}

/// 云盘歌曲列表（分页）
#[tauri::command]
pub fn netease_cloud(
    app: tauri::AppHandle,
    offset: i64,
    limit: i64,
) -> Result<NeteaseCloudPage, String> {
    let (code, body) = api_call(
        "weapi",
        "/api/v1/cloud/get",
        &mut serde_json::json!({ "limit": limit, "offset": offset }),
    )?;
    if code != 200 {
        return Err(err_for_code(code));
    }
    let data = &body["data"];
    let songs = data["songs"].as_array().cloned().unwrap_or_default();
    let mapped = songs
        .iter()
        .filter_map(|s| {
            let song = &s["song"];
            let id = s["songId"]
                .as_i64()
                .or_else(|| song["id"].as_i64())?;
            let artist = song["ar"]
                .as_array()
                .map(|ars| {
                    ars.iter()
                        .filter_map(|a| a["name"].as_str())
                        .collect::<Vec<_>>()
                        .join("/")
                })
                .unwrap_or_default();
            Some(NeteaseSong {
                id,
                name: song["name"].as_str().unwrap_or("").to_string(),
                artist,
                album: song["al"]["name"].as_str().map(|s| s.to_string()),
                pic_url: song["al"]["picUrl"]
                    .as_str()
                    .or_else(|| song["picUrl"].as_str())
                    .map(|s| s.to_string()),
            })
        })
        .collect();
    Ok(NeteaseCloudPage {
        songs: mapped,
        has_more: data["hasMore"].as_bool().unwrap_or(false),
        count: data["count"].as_i64().unwrap_or(0),
    })
}

/// 批量获取歌曲播放 URL（br=999000 最高可用）
#[tauri::command]
pub fn netease_song_url(
    app: tauri::AppHandle,
    ids: Vec<i64>,
) -> Result<Vec<NeteaseSongUrl>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let ids_json = serde_json::to_string(&ids).map_err(|e| e.to_string())?;
    let (code, body) = api_call(
        "eapi",
        "/api/song/enhance/player/url",
        &mut serde_json::json!({ "ids": ids_json, "br": 999000 }),
    )?;
    if code != 200 {
        return Err(err_for_code(code));
    }
    let data = body["data"].as_array().cloned().unwrap_or_default();
    Ok(data
        .iter()
        .filter_map(|d| {
            Some(NeteaseSongUrl {
                id: d["id"].as_i64()?,
                url: d["url"].as_str().unwrap_or("").to_string(),
            })
        })
        .collect())
}

/// 退出登录：清内存 + 删持久化文件
#[tauri::command]
pub fn netease_logout(app: tauri::AppHandle) -> Result<(), String> {
    clear_persist(&app);
    Ok(())
}