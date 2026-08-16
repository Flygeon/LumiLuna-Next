//! 网易云音乐账号模块：扫码登录 / 账号信息 / 我的歌单 / 云盘歌曲 / 播放 URL。
//!
//! 签名算法（weapi / eapi）与请求特征移植自 api-enhanced 项目
//! （https://github.com/neteasecloudmusicapienhanced/api-enhanced，MIT）：
//! - weapi：双层 AES-128-CBC（presetKey + 随机 secretKey）+ RSA-1024 PKCS1v15
//! - eapi：MD5 拼接 + AES-128-ECB（hex 大写输出）
//! 请求与 cookie 全部在 Rust 侧：MUSIC_U 等凭据不进入 WebView；
//! cookie 持久化在 app data 目录，重启后自动恢复登录态。

use std::collections::HashMap;
use std::error::Error as _;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use aes::Aes128;
use aes::Aes256;
use aes_gcm::aead::Aead;
use aes_gcm::{Aes128Gcm, KeyInit as AesGcmKeyInit, Nonce};
use base64::Engine;
use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use ecb::cipher::BlockDecryptMut;
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use rsa::hazmat::rsa_encrypt;
use rsa::pkcs8::DecodePublicKey;
use rsa::traits::PublicKeyParts;
use rsa::RsaPublicKey;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;
use tauri::Manager;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};

// ---- 常量（移植自 api-enhanced util/crypto.js + util/config.json）----

const PRESET_KEY: &[u8; 16] = b"0CoJUm6Qyw8W8jud";
const IV: &[u8; 16] = b"0102030405060708";
const EAPI_KEY: &[u8; 16] = b"e82ckenh8dichen8";
const BASE62: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const LOWER: &[u8] = b"abcdefghijklmnopqrstuvwxyz";

const RSA_PUBLIC_KEY_PEM: &str = "-----BEGIN PUBLIC KEY-----\n\
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ3\n\
7BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvakl\n\
V8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44o\n\
ncaTWz7OBGLbCiK45wIDAQAB\n\
-----END PUBLIC KEY-----";

// 请求特征（参考 util/request.js userAgentMap / osMap）
const UA_EAPI: &str = "NeteaseMusic 9.0.90/5038 (iPhone; iOS 16.2; zh_CN)";
const UA_WEAPI: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
const OS_OSVER: &str = "Microsoft-Windows-10-Professional-build-19045-64bit";
const OS_APPVER: &str = "3.1.17.204416";
const OS_CHANNEL: &str = "netease";
const OS_NAME: &str = "pc";
const DOMAIN: &str = "https://music.163.com";
/// xeapi 域名（api-enhanced util/config.json 的 xeapiDomain）
const XEAPI_DOMAIN: &str = "https://interface3.music.163.com";
/// xeapi 静态密钥（hex，32 字节）
const XEAPI_STATIC_KEY: [u8; 32] = [
    0xab, 0x1d, 0x5a, 0x43, 0x0f, 0x6b, 0xb0, 0x4a, 0x3f, 0x01, 0xe8, 0x1d, 0xdd, 0x72, 0xbd, 0x91,
    0x6d, 0x5c, 0xe5, 0x91, 0x24, 0x8a, 0xc1, 0x28, 0x71, 0x48, 0x06, 0xd7, 0xf8, 0xfb, 0x1b, 0x84,
];
/// xeapi 签名密钥（base64，HMAC-SHA256 用）
const XEAPI_SIGN_KEY_B64: &str = "mUHCwVNWJbunMqAHf5MImuirT6plvs6VSFW62MGHstFQxhBGdEoIhLItH3djc4+FB/OKty3+lL2rGeoFBpVe5g==";
/// xeapi UA（android 客户端）
const UA_XEAPI: &str = "NeteaseMusic/9.5.61.260802021928(9005061);Dalvik/2.1.0 (Linux; U; Android 12; HBN-AL00 Build/cd737a2.0)";
/// 云盘加密 id 的 XOR 密钥（register_anonimous 用）
const ID_XOR_KEY: &[u8] = b"3go8&$8*3*3h0k(2)2";
/// eapi 主域名：与 weapi 同域（NeteaseCloudMusicApi 经典实现路径，可达性最好）
const EAPI_DOMAIN: &str = "https://music.163.com";
/// eapi 备用域名（api-enhanced 的 eapiDomain）：主域连接失败时回退
const EAPI_DOMAIN_FALLBACK: &str = "https://interfacepc.music.163.com";

/// cookie / 设备指纹持久化文件名（app data 目录）
const PERSIST_FILE: &str = "netease.json";

// ---- 持久化状态 ----

/// 落盘数据：cookie（k=v; k=v; ...）+ 设备指纹 + 登录账号缓存
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct NeteasePersist {
    cookie: String,
    device_id: String,
    /// 随机中国 IP（参考 server.js 的 global.cnIp）：X-Real-IP / X-Forwarded-For，
    /// 海外/机房 IP 会被网易风控拦截（空响应 / 设备环境异常），带上后与参考项目一致
    #[serde(default)]
    cn_ip: String,
    uid: Option<i64>,
    profile: Option<NeteaseAccount>,
    /// xeapi 公钥状态（匿名身份注册后缓存）
    xeapi_key: Option<XeapiKey>,
}

static STATE: OnceLock<Mutex<NeteasePersist>> = OnceLock::new();

fn state() -> &'static Mutex<NeteasePersist> {
    STATE.get_or_init(|| Mutex::new(NeteasePersist::default()))
}

/// 是否已从文件加载过持久化状态（只加载一次，避免覆盖登录流程中合并的 cookie）
static LOADED: AtomicBool = AtomicBool::new(false);

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
            // 忽略系统 HTTP_PROXY/HTTPS_PROXY 环境变量：代理不可用时
            // 会报 tunnel error（本机 127.0.0.1:7890 常见），直连更可靠
            .no_proxy()
            // 强制 HTTP/1.1 + native-tls(schannel)：实测 rustls+HTTP/2 组合的
            // weapi 请求被网易云风控返回空 body，而 curl(schannel)+h1.1 同内容成功
            .http1_only()
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

fn aes_cbc_b64(key: &[u8], iv: &[u8; 16], plain: &str) -> Result<String, String> {
    type Aes128CbcEnc = cbc::Encryptor<Aes128>;
    let enc = Aes128CbcEnc::new(key.into(), iv.into());
    // encrypt_padded_vec_mut 需要 cipher 的 alloc feature，这里手动给 buffer
    let msg = plain.as_bytes();
    let mut buf = vec![0u8; msg.len() + 16];
    let ct = enc
        .encrypt_padded_mut::<Pkcs7>(&mut buf, msg.len())
        .map_err(|e| format!("AES 加密失败：{e:?}"))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(ct))
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

// ---- xeapi 协议（匿名身份注册，风控必需；移植自 api-enhanced util/crypto.js）----

/// AES-ECB 解密（PKCS7 去填充），支持 16/32 字节密钥
fn aes_ecb_decrypt(key: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(data.len());
    match key.len() {
        16 => {
            let k: [u8; 16] = key.try_into().map_err(|_| "key len")?;
            let mut cipher = ecb::Decryptor::<Aes128>::new((&k).into());
            for chunk in data.chunks_exact(16) {
                let mut block = aes::Block::clone_from_slice(chunk);
                cipher.decrypt_block_mut(&mut block);
                out.extend_from_slice(&block);
            }
        }
        32 => {
            let k: [u8; 32] = key.try_into().map_err(|_| "key len")?;
            let mut cipher = ecb::Decryptor::<Aes256>::new((&k).into());
            for chunk in data.chunks_exact(16) {
                let mut block = aes::Block::clone_from_slice(chunk);
                cipher.decrypt_block_mut(&mut block);
                out.extend_from_slice(&block);
            }
        }
        _ => return Err("AES key 长度必须是 16 或 32 字节".into()),
    }
    // PKCS7 去填充
    if let Some(&last) = out.last() {
        let pad = last as usize;
        if pad > 0 && pad <= 16 && out.len() >= pad
            && out[out.len() - pad..].iter().all(|&b| b == last)
        {
            out.truncate(out.len() - pad);
        }
    }
    Ok(out)
}

/// AES-ECB 加密（PKCS7），返回原始字节，支持 16/32 字节密钥
fn aes_ecb_encrypt_bytes(key: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let mut bytes = plain.to_vec();
    let pad = 16 - (bytes.len() % 16);
    bytes.extend(std::iter::repeat_n(pad as u8, pad));
    let mut out = Vec::with_capacity(bytes.len());
    match key.len() {
        16 => {
            let k: [u8; 16] = key.try_into().map_err(|_| "key len")?;
            let mut cipher = ecb::Encryptor::<Aes128>::new((&k).into());
            for chunk in bytes.chunks_exact(16) {
                let mut block = aes::Block::clone_from_slice(chunk);
                cipher.encrypt_block_mut(&mut block);
                out.extend_from_slice(&block);
            }
        }
        32 => {
            let k: [u8; 32] = key.try_into().map_err(|_| "key len")?;
            let mut cipher = ecb::Encryptor::<Aes256>::new((&k).into());
            for chunk in bytes.chunks_exact(16) {
                let mut block = aes::Block::clone_from_slice(chunk);
                cipher.encrypt_block_mut(&mut block);
                out.extend_from_slice(&block);
            }
        }
        _ => return Err("AES key 长度必须是 16 或 32 字节".into()),
    }
    Ok(out)
}

/// HMAC-SHA256（xeapiSign）：与参考 crypto.js 一致，key 直接用 base64 字符串的
/// UTF-8 字节（Node createHmac 对字符串 key 不做解码），data = timestamp+nonce
fn xeapi_sign(timestamp: &str, nonce: &str) -> Result<String, String> {
    let mut mac: Hmac<Sha256> =
        Mac::new_from_slice(XEAPI_SIGN_KEY_B64.as_bytes()).map_err(|e| e.to_string())?;
    mac.update(format!("{timestamp}{nonce}").as_bytes());
    Ok(base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes()))
}

/// 派生 X25519 会话 AES 密钥（deriveX25519AesKey）：两层 HMAC-SHA256，取 16 字节
fn derive_x25519_aes_key(shared: &[u8; 32], ephemeral_pub: &[u8; 32]) -> [u8; 16] {
    let zeros = [0u8; 32];
    let mut mac1: Hmac<Sha256> = Mac::new_from_slice(&zeros).expect("hmac key");
    mac1.update(shared);
    let prk = mac1.finalize().into_bytes();
    let mut mac2: Hmac<Sha256> = Mac::new_from_slice(&prk).expect("hmac key");
    let mut msg = Vec::with_capacity(33);
    msg.extend_from_slice(ephemeral_pub);
    msg.push(1);
    mac2.update(&msg);
    let out = mac2.finalize().into_bytes();
    let mut key = [0u8; 16];
    key.copy_from_slice(&out[..16]);
    key
}

/// xeapiEncryptS：X25519 协商 + AES-128-GCM 加密 dynamicKey 材料，返回 [ephPub32|iv12|ct|tag]
fn xeapi_encrypt_s(
    dynamic_key: &[u8; 16],
    peer_raw: &[u8; 32],
    os: &str,
    sk: &str,
) -> Result<Vec<u8>, String> {
    let mut rng = rsa::rand_core::OsRng;
    let secret = StaticSecret::random_from_rng(&mut rng);
    let eph_pub = X25519PublicKey::from(&secret);
    let peer = X25519PublicKey::from(*peer_raw);
    let shared = secret.diffie_hellman(&peer);
    let aes_key = derive_x25519_aes_key(shared.as_bytes(), eph_pub.as_bytes());
    let cipher = Aes128Gcm::new_from_slice(&aes_key).map_err(|e| e.to_string())?;
    let iv = random_bytes(12);
    let plaintext = format!(
        "{}|{}|{}",
        base64::engine::general_purpose::STANDARD.encode(dynamic_key),
        os,
        sk
    );
    let ct = cipher
        .encrypt(Nonce::from_slice(&iv), plaintext.as_bytes())
        .map_err(|e| format!("AES-GCM 加密失败：{e}"))?;
    let mut out = Vec::with_capacity(32 + 12 + ct.len());
    out.extend_from_slice(eph_pub.as_bytes());
    out.extend_from_slice(&iv);
    out.extend_from_slice(&ct);
    Ok(out)
}

/// xeapiMidTransform：随机 16 字节 XOR 循环 + base64 + 旋转
fn xeapi_mid_transform(ciphertext: &[u8]) -> Vec<u8> {
    let random = random_bytes(16);
    let xored: Vec<u8> = ciphertext
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ random[i & 0x0f])
        .collect();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&xored);
    let bytes = b64.into_bytes();
    let rot = if !bytes.is_empty() {
        (random[0] & 0x0f) as usize % bytes.len()
    } else {
        0
    };
    let mut out = random.to_vec();
    out.extend_from_slice(&bytes[rot..]);
    out.extend_from_slice(&bytes[..rot]);
    out
}

/// buildXeapiPlaintext：body（x-www-form-urlencoded 编码后 base64）+ queryString
fn build_xeapi_plaintext(data: &Value) -> Vec<u8> {
    let mut params: Vec<(String, String)> = Vec::new();
    if let Some(obj) = data.as_object() {
        for (k, v) in obj {
            if k == "e_r" {
                continue;
            }
            params.push((
                k.clone(),
                v.as_str()
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| v.to_string().trim_matches('"').to_string()),
            ));
        }
    }
    let body = params
        .iter()
        .map(|(k, v)| format!("{}={}", encode_uri_component(k), encode_uri_component(v)))
        .collect::<Vec<_>>()
        .join("&");
    let body_b64 = base64::engine::general_purpose::STANDARD.encode(body.as_bytes());
    let fields = serde_json::json!({
        "body": body_b64,
        "queryString": "e_r=true",
    });
    fields.to_string().into_bytes()
}

/// xeapi 三层加密，返回 (B, S, R)
fn xeapi_encrypt(
    _uri: &str,
    data: &Value,
    public_key_state: &XeapiKey,
    os: &str,
) -> Result<(String, String, String), String> {
    let plaintext = build_xeapi_plaintext(data);
    let dynamic_key: [u8; 16] = random_bytes(16)
        .try_into()
        .map_err(|_| "dynamic key 长度错误")?;
    let inner = aes_ecb_encrypt_bytes(&XEAPI_STATIC_KEY, &plaintext)?;
    let mid = xeapi_mid_transform(&inner);
    let b = aes_ecb_encrypt_bytes(&dynamic_key, &mid)?;
    let peer_raw: [u8; 32] = base64::engine::general_purpose::STANDARD
        .decode(&public_key_state.public_key)
        .map_err(|e| format!("xeapi peer key 解码失败：{e}"))?
        .try_into()
        .map_err(|_| "xeapi peer key 长度错误".to_string())?;
    let s = xeapi_encrypt_s(&dynamic_key, &peer_raw, os, &public_key_state.sk)?;
    let r = aes_ecb_encrypt_bytes(
        &XEAPI_STATIC_KEY,
        format!("{}|", public_key_state.version).as_bytes(),
    )?;
    Ok((
        base64::engine::general_purpose::STANDARD.encode(b),
        base64::engine::general_purpose::STANDARD.encode(s),
        base64::engine::general_purpose::STANDARD.encode(r),
    ))
}

/// 解密 xeapi 响应（AES-ECB(eapiKey) → 可能 gzip → JSON）
fn xeapi_res_decrypt(body: &[u8]) -> Result<Value, String> {
    let dec = aes_ecb_decrypt(EAPI_KEY, body)?;
    let plain = if dec.len() >= 2 && dec[0] == 0x1f && dec[1] == 0x8b {
        use std::io::Read;
        let mut decoder = flate2::read::GzDecoder::new(&dec[..]);
        let mut out = String::new();
        decoder
            .read_to_string(&mut out)
            .map_err(|e| format!("xeapi gzip 解压失败：{e}"))?;
        out
    } else {
        String::from_utf8_lossy(&dec).into_owned()
    };
    serde_json::from_str(&plain).map_err(|e| format!("xeapi 响应解析失败：{e}"))
}

/// cloudmusic_dll_encode_id：XOR + MD5 → base64（匿名注册 username 用）
fn cloudmusic_dll_encode_id(some_id: &str) -> String {
    let xored: Vec<u8> = some_id
        .bytes()
        .enumerate()
        .map(|(i, b)| b ^ ID_XOR_KEY[i % ID_XOR_KEY.len()])
        .collect();
    base64::engine::general_purpose::STANDARD.encode(Md5::digest(&xored))
}

/// xeapi public key 状态（/api/gorilla/anti/crawler/security/key/get 解密结果）
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct XeapiKey {
    public_key: String,
    version: String,
    sk: String,
}

/// 获取 xeapi public key（明文请求 + 响应签名校验 + AES-ECB 解密）
fn get_xeapi_key(_app: &tauri::AppHandle) -> Result<XeapiKey, String> {
    let device_id = {
        let persist = state().lock().unwrap();
        persist.device_id.clone()
    };
    let nonce = (0..16)
        .map(|_| char::from(b'0' + (random_bytes(1)[0] % 10)))
        .collect::<String>();
    let timestamp = now_millis().to_string();
    let signature = xeapi_sign(&timestamp, &nonce)?;
    let body = format!(
        "appVersion=9.5.61&currentKeyVersion=&deviceId={}&nonce={}&os=android&requestType=active&signature={}&t1=&t2=&timestamp={}&uid=",
        encode_uri_component(&device_id),
        nonce,
        encode_uri_component(&signature),
        timestamp
    );
    let resp = client()
        .post("https://interface.music.163.com/api/gorilla/anti/crawler/security/key/get")
        .header("User-Agent", UA_XEAPI)
        .header("Cookie", format!("deviceId={}", encode_uri_component(&device_id)))
        .header("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
        .body(body)
        .timeout(Duration::from_secs(30))
        .send()
        .map_err(|e| format!("获取网易云密钥失败：{}", reqwest_detail(&e)))?;
    let status = resp.status().as_u16();
    let text = resp.text().map_err(|e| format!("读取密钥响应失败：{e}"))?;
    let json: Value = serde_json::from_str(&text).map_err(|_| {
        let preview: String = text
            .chars()
            .take(160)
            .map(|c| match c {
                '\n' => '\u{23ce}',
                '\r' => '\u{240d}',
                '\t' => '\u{2409}',
                c if c.is_control() => '\u{00b7}',
                c => c,
            })
            .collect();
        format!(
            "密钥响应解析失败（HTTP {status}，{} 字节）：{preview}",
            text.len()
        )
    })?;
    if json["code"].as_i64() != Some(200) {
        return Err(format!("网易云返回错误（code={:?}）", json["code"]));
    }
    let data = &json["data"];
    let encrypted = data["encryptedData"].as_str().unwrap_or_default();
    // 校验响应签名（可选，签名缺失时不拦截）
    let resp_ts = data["timestamp"].as_str().unwrap_or_default();
    let resp_sig = data["signature"].as_str().unwrap_or_default();
    if let Ok(expected) = xeapi_sign(resp_ts, &nonce) {
        if !resp_sig.is_empty() && expected != resp_sig {
            return Err("密钥响应签名校验失败".into());
        }
    }
    let enc_bytes = base64::engine::general_purpose::STANDARD
        .decode(encrypted)
        .map_err(|e| format!("密钥密文解码失败：{e}"))?;
    let dec = aes_ecb_decrypt(&XEAPI_STATIC_KEY, &enc_bytes)?;
    let key_json: Value =
        serde_json::from_slice(&dec).map_err(|e| format!("密钥解密结果解析失败：{e}"))?;
    Ok(XeapiKey {
        public_key: key_json["publicKey"].as_str().unwrap_or_default().to_string(),
        version: key_json["version"].as_str().unwrap_or_default().to_string(),
        sk: key_json["sk"].as_str().unwrap_or_default().to_string(),
    })
}

/// 注册匿名身份：xeapi 调用 /api/register/anonimous，拿 MUSIC_A cookie
fn register_anonymous(app: &tauri::AppHandle) -> Result<(), String> {
    let xeapi_key = get_xeapi_key(app)?;
    let device_id = {
        let persist = state().lock().unwrap();
        persist.device_id.clone()
    };
    let encoded_id = base64::engine::general_purpose::STANDARD.encode(
        format!(
            "{} {}",
            device_id,
            cloudmusic_dll_encode_id(&device_id)
        )
        .as_bytes(),
    );
    let result = xeapi_call(
        "/api/register/anonimous",
        &mut serde_json::json!({ "username": encoded_id }),
        &xeapi_key,
    )?;
    if result["code"].as_i64() != Some(200) {
        return Err(format!("匿名身份注册失败（code={:?}）", result["code"]));
    }
    // 保存 xeapi key 与匿名 cookie（含 MUSIC_A）
    {
        let mut persist = state().lock().unwrap();
        persist.xeapi_key = Some(xeapi_key);
        save_persist(app, &persist)?;
    }
    Ok(())
}

/// xeapi 请求：三层加密 → 专用头 → 合并 cookie → 解密响应
fn xeapi_call(
    uri: &str,
    data: &mut Value,
    public_key_state: &XeapiKey,
) -> Result<Value, String> {
    let (music_u, device_id, cn_ip, cookie_map) = {
        let mut persist = state().lock().unwrap();
        let cookie_map = cookie_to_map(&persist.cookie);
        if persist.cn_ip.is_empty() {
            let b = random_bytes(3);
            persist.cn_ip = format!("116.{}.{}.{}", 25 + (b[0] % 70), b[1], b[2]);
        }
        (
            cookie_map.get("MUSIC_U").cloned().unwrap_or_default(),
            persist.device_id.clone(),
            persist.cn_ip.clone(),
            cookie_map,
        )
    };

    let os = "android";
    let appver = "9.1.65";
    let osver = "16";
    let buildver = now_millis().to_string()[..10].to_string();

    // 专用请求头（参考 request.js xeapi 分支）
    let mut headers: Vec<(String, String)> = vec![
        ("X-Client-Enc-State".into(), "ENCRYPTED".into()),
        ("x-aeapi".into(), "true".into()),
        ("Content-Type".into(), "application/x-www-form-urlencoded;charset=utf-8".into()),
        ("x-deviceid".into(), device_id.clone()),
        ("x-os".into(), os.into()),
        ("x-osver".into(), osver.into()),
        ("x-appver".into(), appver.into()),
        ("x-sdeviceid".into(), device_id.clone()),
        ("x-buildver".into(), buildver.clone()),
        ("User-Agent".into(), UA_XEAPI.into()),
        ("X-Real-IP".into(), cn_ip.clone()),
        ("X-Forwarded-For".into(), cn_ip.clone()),
    ];
    if !music_u.is_empty() {
        headers.push(("x-music-u".into(), music_u));
    }
    let mut cookie = cookie_map;
    cookie.insert("os".into(), os.into());
    cookie.insert("osver".into(), osver.into());
    cookie.insert("appver".into(), appver.into());
    cookie.insert("buildver".into(), buildver);
    cookie.insert("deviceId".into(), device_id.clone());
    cookie.insert("sDeviceId".into(), device_id.clone());
    headers.push(("Cookie".into(), map_to_cookie(&cookie)));

    let (b, s, r) = xeapi_encrypt(uri, data, public_key_state, os)?;

    let url = format!("{XEAPI_DOMAIN}/xeapi/{}", uri.trim_start_matches("/api"));
    let mut req = client()
        .post(&url)
        .body(format!(
            "B={}&S={}&R={}",
            encode_uri_component(&b),
            encode_uri_component(&s),
            encode_uri_component(&r)
        ))
        .timeout(Duration::from_secs(30));
    for (k, v) in &headers {
        req = req.header(k, v);
    }
    let resp = req
        .send()
        .map_err(|e| format!("无法连接网易云：{}", reqwest_detail(&e)))?;

    {
        let mut persist = state().lock().unwrap();
        merge_set_cookie(&mut persist, &resp);
    }
    let bytes = resp
        .bytes()
        .map_err(|e| format!("读取网易云响应失败：{e}"))?;
    xeapi_res_decrypt(&bytes)
}

/// RSA-1024 无填充加密（raw modpow，小写 hex 输出）。
/// 参考 crypto.js rsaEncrypt：forge publicKey.encrypt(str, 'NONE') ——
/// node-forge 的 'NONE' 模式是裸 RSA（无 PKCS1 填充），见 rsa.js 中
/// ['RAW','NONE','NULL',null] 分支：encode: e => e。
/// 网易云服务端对 weapi 的 encSecKey 做裸 RSA 解密；若用 PKCS1v1.5 填充，
/// 解密结果含填充头、secretKey 提取失败，响应为空 body（HTTP 200 0 字节）。
/// 公钥是 SPKI 格式（BEGIN PUBLIC KEY），必须用 pkcs8 解析
/// （pkcs1::DecodeRsaPublicKey 只认 BEGIN RSA PUBLIC KEY，运行期会解析失败）。
fn rsa_encrypt_hex(data: &[u8]) -> Result<String, String> {
    let key = RsaPublicKey::from_public_key_pem(RSA_PUBLIC_KEY_PEM)
        .map_err(|e| format!("网易云 RSA 公钥解析失败：{e}"))?;
    let m = rsa::BigUint::from_bytes_be(data);
    let c = rsa_encrypt(&key, &m).map_err(|e| format!("网易云 RSA 加密失败：{e}"))?;
    let bytes = c.to_bytes_be();
    // 补齐到密钥长度（128 字节），与 forge bytesToHex 的定长输出一致
    let size = key.size();
    let mut out = vec![0u8; size];
    if bytes.len() <= size {
        out[size - bytes.len()..].copy_from_slice(&bytes);
    } else {
        out = bytes;
    }
    Ok(out.iter().map(|b| format!("{b:02x}")).collect())
}

/// weapi 加密：双层 AES-CBC + RSA（返回 (params, encSecKey)）。
/// 层序参考 crypto.js weapi：内层 presetKey、外层 secretKey ——
/// aesEncrypt(aesEncrypt(text,'cbc',presetKey,iv),'cbc',secretKey,iv)。
/// 服务端用 RSA 裸解密 encSecKey 得 secretKey 后先解外层再解内层；
/// 层序写反（secretKey 内层）会导致解密失败、响应为空 body。
fn weapi(data: &Value) -> Result<(String, String), String> {
    let text = data.to_string();
    let secret = random_base62(16);
    let inner = aes_cbc_b64(PRESET_KEY, IV, &text)?;
    let params = aes_cbc_b64(secret.as_bytes(), IV, &inner)?;
    let reversed: String = secret.chars().rev().collect();
    let enc_sec_key = rsa_encrypt_hex(reversed.as_bytes())?;
    Ok((params, enc_sec_key))
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

/// reqwest 错误信息带上底层原因链（DNS/TLS/连接拒绝等），便于排查
fn reqwest_detail(e: &reqwest::Error) -> String {
    let mut msg = e.to_string();
    let mut src = e.source();
    for _ in 0..3 {
        match src {
            Some(s) => {
                msg.push_str(&format!(" → {s}"));
                src = s.source();
            }
            None => break,
        }
    }
    msg
}

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
    if persist.cn_ip.is_empty() {
        let b = random_bytes(3);
        persist.cn_ip = format!("116.{}.{}.{}", 25 + (b[0] % 70), b[1], b[2]);
    }
    let cn_ip = persist.cn_ip.clone();
    // 响应明文模式（参考 request.js：encryptResponse=false 时 data.e_r=false）
    data["e_r"] = Value::Bool(false);

    let (body, candidate_urls, headers): (String, Vec<String>, Vec<(String, String)>) =
        if crypto == "weapi" {
            data["csrf_token"] = Value::String(csrf.clone());
            let (params, enc_sec_key) = weapi(data)?;
            let body = format!(
                "params={}&encSecKey={}",
                encode_uri_component(&params),
                encode_uri_component(&enc_sec_key)
            );
            let cookie = build_weapi_cookie(&cookie_map, &device_id, path);
            (
                body,
                vec![format!(
                    "{DOMAIN}/weapi/{}",
                    path.trim_start_matches("/api")
                )],
                vec![
                    ("User-Agent".to_string(), UA_WEAPI.to_string()),
                    ("Referer".to_string(), DOMAIN.to_string()),
                    ("Cookie".to_string(), cookie),
                    ("Content-Type".to_string(), "application/x-www-form-urlencoded;charset=utf-8".to_string()),
                    ("X-Real-IP".to_string(), cn_ip.clone()),
                    ("X-Forwarded-For".to_string(), cn_ip.clone()),
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
            let cookie = build_eapi_cookie(&header);
            let rel = path.trim_start_matches("/api");
            (
                body,
                vec![
                    format!("{EAPI_DOMAIN}/eapi/{rel}"),
                    format!("{EAPI_DOMAIN_FALLBACK}/eapi/{rel}"),
                ],
                vec![
                    ("User-Agent".to_string(), UA_EAPI.to_string()),
                    ("Cookie".to_string(), cookie),
                    ("Content-Type".to_string(), "application/x-www-form-urlencoded;charset=utf-8".to_string()),
                    ("X-Real-IP".to_string(), cn_ip.clone()),
                    ("X-Forwarded-For".to_string(), cn_ip.clone()),
                ],
            )
        };
    drop(persist);

    // 连接失败时依次尝试候选域名（eapi：主域 → 备用域）
    let mut resp: Option<reqwest::blocking::Response> = None;
    let mut last_err: Option<reqwest::Error> = None;
    for url in &candidate_urls {
        let mut req = client()
            .post(url)
            .body(body.clone())
            .timeout(Duration::from_secs(30));
        for (k, v) in &headers {
            req = req.header(k, v);
        }
        match req.send() {
            Ok(r) => {
                resp = Some(r);
                break;
            }
            Err(e) => last_err = Some(e),
        }
    }
    let resp = resp.ok_or_else(|| match last_err {
        Some(e) => format!("无法连接网易云：{}", reqwest_detail(&e)),
        None => "无法连接网易云（未知网络错误）".to_string(),
    })?;

    // 合并 Set-Cookie（登录成功的关键：MUSIC_U 等）
    {
        let mut persist = state().lock().map_err(|e| e.to_string())?;
        merge_set_cookie(&mut persist, &resp);
    }

    let status = resp.status().as_u16();
    let text = resp.text().map_err(|e| format!("读取网易云响应失败：{e}"))?;
    let body: Value = serde_json::from_str(&text).map_err(|_| {
        let preview: String = text
            .chars()
            .take(200)
            .map(|c| match c {
                '\n' => '\u{23ce}',
                '\r' => '\u{240d}',
                '\t' => '\u{2409}',
                c if c.is_control() => '\u{00b7}',
                c => c,
            })
            .collect();
        // 诊断信息：完整请求头 + 加密产物前缀（定位与参考实现/curl 的差异）
        let music_u_preview = cookie_map
            .get("MUSIC_U")
            .map(|v| {
                let head: String = v.chars().take(20).collect();
                format!("{}…(共{}字符)", head, v.len())
            })
            .unwrap_or_else(|| "无".to_string());
        let csrf_preview = cookie_map
            .get("__csrf")
            .map(|v| {
                let head: String = v.chars().take(12).collect();
                format!("{}…(共{}字符)", head, v.len())
            })
            .unwrap_or_else(|| "无".to_string());
        let header_desc: String = headers
            .iter()
            .map(|(k, v)| {
                if k.eq_ignore_ascii_case("cookie") {
                    // cookie 头太长，只显示键
                    let keys: Vec<&str> = v
                        .split(';')
                        .filter_map(|p| p.trim().split_once('=').map(|(k2, _)| k2))
                        .collect();
                    format!("Cookie[{}]", keys.join(","))
                } else {
                    format!("{k}={v}")
                }
            })
            .collect::<Vec<_>>()
            .join(" | ");
        let body_full: String = body.chars().take(700).collect();
        format!(
            "网易云响应解析失败（{}，HTTP {status}，{} 字节）：{preview}【诊断：MUSIC_U={}，__csrf={}，headers={}，URL={}，BODY={}】",
            path.trim_start_matches("/api"),
            text.len(),
            music_u_preview,
            csrf_preview,
            header_desc,
            candidate_urls.join(","),
            body_full,
        )
    })?;
    let code = body["code"].as_i64().unwrap_or(0);
    Ok((code, body))
}

fn rand4() -> u32 {
    let b = random_bytes(2);
    u32::from(b[0]) * 256 + u32::from(b[1])
}

// ---- 账号信息 ----

fn fetch_account(_app: &tauri::AppHandle) -> Result<NeteaseAccount, String> {
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
pub async fn netease_login_qr_key(app: tauri::AppHandle) -> Result<String, String> {
    // spawn_blocking：网络请求不占主线程，避免冻结 UI
    tauri::async_runtime::spawn_blocking(move || netease_login_qr_key_sync(app))
        .await
        .map_err(|e| format!("网易云请求异常：{e}"))?
}

fn netease_login_qr_key_sync(app: tauri::AppHandle) -> Result<String, String> {
    // 启动时恢复持久化状态（仅首次）
    ensure_loaded(&app);
    // 风控前置：无登录凭据（MUSIC_U）时先注册匿名身份（xeapi → MUSIC_A），
    // 否则扫码会被网易云判定"设备环境异常"拦截（参考项目对照实验已验证）
    let mut register_err: Option<String> = None;
    {
        let persist = state().lock().unwrap();
        let map = cookie_to_map(&persist.cookie);
        let has_music_u = map.contains_key("MUSIC_U");
        let has_music_a = map.contains_key("MUSIC_A");
        let has_key = persist.xeapi_key.is_some();
        if !has_music_u && (!has_music_a || !has_key) {
            drop(persist);
            if let Err(e) = register_anonymous(&app) {
                eprintln!("[网易云] 匿名身份注册失败（扫码可能被风控）：{e}");
                register_err = Some(e);
            }
        }
    }
    let (code, body) = api_call(
        "eapi",
        "/api/login/qrcode/unikey",
        &mut serde_json::json!({ "type": 3 }),
    )
    .map_err(|e| match register_err {
        Some(re) => format!("匿名身份注册失败：{re}；二维码接口失败：{e}"),
        None => e,
    })?;
    if code != 200 {
        return Err(err_for_code(code));
    }
    // 实测响应为 {"code":200,"unikey":"..."}（unikey 在顶层）；
    // 兼容个别版本放 data 下的情况
    let unikey = body["data"]["unikey"]
        .as_str()
        .or_else(|| body["unikey"].as_str())
        .unwrap_or_default()
        .to_string();
    if unikey.is_empty() {
        return Err("未获取到登录二维码".into());
    }
    Ok(unikey)
}

/// 轮询扫码状态：800 等待 / 801 已扫码 / 802 确认中 / 803 登录成功
#[tauri::command]
pub async fn netease_login_qr_check(
    app: tauri::AppHandle,
    key: String,
) -> Result<NeteaseQrCheck, String> {
    tauri::async_runtime::spawn_blocking(move || netease_login_qr_check_sync(app, key))
        .await
        .map_err(|e| format!("网易云请求异常：{e}"))?
}

fn netease_login_qr_check_sync(
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
pub async fn netease_account(app: tauri::AppHandle) -> Result<NeteaseAccount, String> {
    tauri::async_runtime::spawn_blocking(move || netease_account_sync(app))
        .await
        .map_err(|e| format!("网易云请求异常：{e}"))?
}

fn netease_account_sync(app: tauri::AppHandle) -> Result<NeteaseAccount, String> {
    ensure_loaded(&app);
    // 未登录（无 MUSIC_U）时直接返回未登录：裸 weapi 请求会被风控以
    // 空响应拦截（"网易云响应解析失败："），且启动时无需任何网络往返
    {
        let persist = state().lock().unwrap();
        let map = cookie_to_map(&persist.cookie);
        if !map.contains_key("MUSIC_U") {
            return Err("未登录".to_string());
        }
    }
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
pub async fn netease_user_playlists(
    app: tauri::AppHandle,
    offset: i64,
    limit: i64,
) -> Result<Vec<NeteasePlaylist>, String> {
    tauri::async_runtime::spawn_blocking(move || netease_user_playlists_sync(app, offset, limit))
        .await
        .map_err(|e| format!("网易云请求异常：{e}"))?
}

fn netease_user_playlists_sync(
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
pub async fn netease_playlist_detail(
    _app: tauri::AppHandle,
    id: i64,
) -> Result<Vec<NeteaseSong>, String> {
    tauri::async_runtime::spawn_blocking(move || netease_playlist_detail_sync(id))
        .await
        .map_err(|e| format!("网易云请求异常：{e}"))?
}

fn netease_playlist_detail_sync(id: i64) -> Result<Vec<NeteaseSong>, String> {
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
pub async fn netease_cloud(
    _app: tauri::AppHandle,
    offset: i64,
    limit: i64,
) -> Result<NeteaseCloudPage, String> {
    tauri::async_runtime::spawn_blocking(move || netease_cloud_sync(offset, limit))
        .await
        .map_err(|e| format!("网易云请求异常：{e}"))?
}

fn netease_cloud_sync(offset: i64, limit: i64) -> Result<NeteaseCloudPage, String> {
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
pub async fn netease_song_url(
    _app: tauri::AppHandle,
    ids: Vec<i64>,
) -> Result<Vec<NeteaseSongUrl>, String> {
    tauri::async_runtime::spawn_blocking(move || netease_song_url_sync(ids))
        .await
        .map_err(|e| format!("网易云请求异常：{e}"))?
}

fn netease_song_url_sync(ids: Vec<i64>) -> Result<Vec<NeteaseSongUrl>, String> {
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
pub async fn netease_logout(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        clear_persist(&app);
        Ok(())
    })
    .await
    .map_err(|e| format!("网易云请求异常：{e}"))?
}