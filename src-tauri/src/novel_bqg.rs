//! 在线小说模块：笔趣阁（https://www.bqg413.cc）。
//!
//! 该站是 hash 路由 SPA（书籍 `/#/book/{id}/`、章节 `/#/book/{id}/{n}.html`），
//! 页面 HTML 只是空壳，数据全部由 `/api/*` 提供。**不需要也不应该**用 WebView 加载：
//! 站点脚本里带 `GoUrl()` 域名劫持（探测 sr700.org 等镜像 favicon，加载成功即跳广告页）。
//!
//! 接口分两类：
//! - 明文 GET：`/api/index?sort=index`（首页）、`/api/search?q=`（搜索）、`/api/sort?sort=`（分类）
//! - 加密 GET：`/api/book`（详情）、`/api/booklist`（目录）、`/api/chapter`（正文）
//!   参数 JSON 经 AES-128-CBC/PKCS7 加密 → base64 → percent-encode 后放在 `?token=`。
//!   密钥推导（原站 `enaes()`）：`code = MD5("book@token.html")` 的 32 位 hex 串，
//!   `iv = code[0..16]`、`key = code[16..32]`，均按 UTF-8 取字节。
//!
//! 目录接口返回的是**纯章节名数组**，章节号即数组下标 +1（与原站 `{n}.html` 一一对应）。
//!
//! 数据结构复用 `crate::novel` 的 Novel* 类型，前端无需新增类型。

use crate::novel::{NovelChapter, NovelContent, NovelCover, NovelDetail, NovelVolume};
use aes::Aes128;
use base64::Engine;
use cbc::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};
use md5::{Digest, Md5};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::Value;
use std::collections::HashSet;

/// 站点主域：页面、明文接口、封面图都在这里（加密接口亦可直连，见 `get_api_json`）
const SITE: &str = "https://www.bqg413.cc";
/// 加密接口备用域名池（原站 `site[]`，主域失败时依次回退）
const API_FALLBACKS: [&str; 3] = ["https://apibi.cc", "https://apiqu.cc", "https://apige.cc"];
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0";
/// 加密 token 的密钥种子（原站 `enaes()` 中 MD5 的输入）
const TOKEN_SEED: &str = "book@token.html";
/// 单次请求超时（秒）
const TIMEOUT_SECS: u64 = 20;

// ----------------------------------------------------------------------------
// HTTP 基础
// ----------------------------------------------------------------------------

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .user_agent(UA)
        .build()
        .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))
}

/// GET 一个 JSON 接口；带 `Referer` 以通过站点的来源校验。
async fn get_json(url: &str, referer: &str) -> Result<Value, String> {
    let resp = client()?
        .get(url)
        .header(reqwest::header::REFERER, referer)
        .header(
            reqwest::header::ACCEPT,
            "application/json, text/javascript, */*; q=0.01",
        )
        .send()
        .await
        .map_err(|e| format!("网络请求失败：{e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("笔趣阁返回 HTTP {}，可稍后重试", status.as_u16()));
    }
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败：{e}"))?;
    serde_json::from_str(&body)
        .map_err(|_| "笔趣阁返回了非 JSON 内容（可能被站点拦截）".to_string())
}

// ----------------------------------------------------------------------------
// 加密 token（原站 enaes：AES-128-CBC/PKCS7，key/iv 由 MD5 hex 串切分而来）
// ----------------------------------------------------------------------------

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

/// 生成 `?token=` 的值：base64(AES-128-CBC(PKCS7, params_json)) 再做 percent-encode。
fn encrypt_token(plain: &str) -> Result<String, String> {
    type Aes128CbcEnc = cbc::Encryptor<Aes128>;

    let code = to_hex(&Md5::digest(TOKEN_SEED.as_bytes()));
    let (iv_s, key_s) = code.split_at(16);
    let iv: [u8; 16] = iv_s
        .as_bytes()
        .try_into()
        .map_err(|_| "token IV 长度异常".to_string())?;
    let key: [u8; 16] = key_s
        .as_bytes()
        .try_into()
        .map_err(|_| "token KEY 长度异常".to_string())?;

    let msg = plain.as_bytes();
    // encrypt_padded_mut 是就地接口：buf 前 msg.len() 字节必须先拷入明文
    let mut buf = vec![0u8; msg.len() + 16];
    buf[..msg.len()].copy_from_slice(msg);
    let ct = Aes128CbcEnc::new((&key).into(), (&iv).into())
        .encrypt_padded_mut::<Pkcs7>(&mut buf, msg.len())
        .map_err(|e| format!("AES 加密失败：{e:?}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(ct);
    Ok(utf8_percent_encode(&b64, NON_ALPHANUMERIC).to_string())
}

/// 调用加密接口；主域失败时依次回退到备用域名池。
///
/// `params_json` 用手工拼好的 JSON 字符串而非 `serde_json::json!`：后者在未开
/// `preserve_order` 时按字典序输出（`{"chapterid":..,"id":..}`），手拼可保证与浏览器
/// `JSON.stringify` 的字节序完全一致，密文因此与浏览器等价。
async fn get_api_json(path: &str, params_json: &str) -> Result<Value, String> {
    let token = encrypt_token(params_json)?;
    let referer = format!("{SITE}/");
    let mut last_err = "笔趣阁接口暂不可用".to_string();
    for host in std::iter::once(SITE).chain(API_FALLBACKS.iter().copied()) {
        let url = format!("{host}/api/{path}?token={token}");
        match get_json(&url, &referer).await {
            Ok(v) => return Ok(v),
            Err(e) => last_err = e,
        }
    }
    Err(last_err)
}

// ----------------------------------------------------------------------------
// 解析工具
// ----------------------------------------------------------------------------

/// 取 JSON 字段为字符串：数字与字符串都接。
fn value_str(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// 书籍 / 章节编号一律是正整数，接口期望 JSON 里是数字（不是字符串）
fn parse_id(s: &str) -> Result<i64, String> {
    s.trim()
        .parse::<i64>()
        .map_err(|_| format!("非法的小说编号：{s}"))
}

/// 封面：`{SITE}/bookimg/{id/1000}/{id}.jpg`（原站 url_img）
fn cover_url(id: &str) -> String {
    match id.parse::<i64>() {
        Ok(n) => format!("{SITE}/bookimg/{}/{}.jpg", n / 1000, id),
        Err(_) => String::new(),
    }
}

fn cover_from(it: &Value) -> Option<NovelCover> {
    let aid = value_str(it.get("id"));
    if aid.is_empty() {
        return None;
    }
    let author = value_str(it.get("author"));
    Some(NovelCover {
        image_url: cover_url(&aid),
        aid,
        title: value_str(it.get("title")),
        author: if author.is_empty() {
            None
        } else {
            Some(author)
        },
    })
}

/// 原站正文用单个 `\n` 分段，而阅读器按 `\n\n` 切段落，这里统一成空行分段。
fn normalize_text(txt: &str) -> String {
    txt.split('\n')
        .map(|l| l.trim_end())
        .filter(|l| !l.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

// ----------------------------------------------------------------------------
// 命令
// ----------------------------------------------------------------------------

/// 首页书目：合并 hotlist / toplist / sort1..6（按书号去重）。
#[tauri::command]
pub async fn bqg_home() -> Result<Vec<NovelCover>, String> {
    let url = format!("{SITE}/api/index?sort=index");
    let v = get_json(&url, &format!("{SITE}/")).await?;
    let mut out: Vec<NovelCover> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for key in [
        "hotlist", "toplist", "sort1", "sort2", "sort3", "sort4", "sort5", "sort6",
    ] {
        let Some(arr) = v.get(key).and_then(|x| x.as_array()) else {
            continue;
        };
        for it in arr {
            if let Some(c) = cover_from(it) {
                if seen.insert(c.aid.clone()) {
                    out.push(c);
                }
            }
        }
    }
    Ok(out)
}

/// 书籍详情。
#[tauri::command]
pub async fn bqg_detail(aid: String) -> Result<NovelDetail, String> {
    let id = parse_id(&aid)?;
    let v = get_api_json("book", &format!(r#"{{"id":{id}}}"#)).await?;
    Ok(NovelDetail {
        img_url: cover_url(&aid),
        aid,
        title: value_str(v.get("title")),
        author: value_str(v.get("author")),
        status: value_str(v.get("full")),
        fin_update: value_str(v.get("lastupdate")),
        introduce: value_str(v.get("intro")),
        tags: {
            let sort = value_str(v.get("sortname"));
            if sort.is_empty() {
                Vec::new()
            } else {
                vec![sort]
            }
        },
        heat: value_str(v.get("lastchapterid")),
        trending: value_str(v.get("lastchapter")),
    })
}

/// 搜索（关键字为空时直接返回空，避免各站热门混入造成「点 A 看 B」）。
#[tauri::command]
pub async fn bqg_search(query: String) -> Result<Vec<NovelCover>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let qs = utf8_percent_encode(q, NON_ALPHANUMERIC).to_string();
    let url = format!("{SITE}/api/search?q={qs}");
    let v = get_json(&url, &format!("{SITE}/")).await?;
    Ok(v.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| arr.iter().filter_map(cover_from).collect())
        .unwrap_or_default())
}

/// 目录：接口返回纯章节名数组，章节号 = 下标 + 1（对应原站 `{n}.html`）。
#[tauri::command]
pub async fn bqg_catalogue(aid: String) -> Result<Vec<NovelVolume>, String> {
    let id = parse_id(&aid)?;
    let v = get_api_json("booklist", &format!(r#"{{"id":{id}}}"#)).await?;
    let list = v
        .get("list")
        .and_then(|x| x.as_array())
        .cloned()
        .unwrap_or_default();
    if list.is_empty() {
        return Err("笔趣阁未返回目录，可稍后重试".to_string());
    }
    // 不能过滤空条目：章节号必须严格等于原数组下标 +1，否则会与 {n}.html 错位
    let chapters: Vec<NovelChapter> = list
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let title = value_str(Some(n));
            NovelChapter {
                cid: (i + 1).to_string(),
                title: if title.is_empty() {
                    format!("第{}章", i + 1)
                } else {
                    title
                },
            }
        })
        .collect();
    Ok(vec![NovelVolume {
        title: "正文".to_string(),
        chapters,
    }])
}

/// 章节正文。
#[tauri::command]
pub async fn bqg_content(aid: String, cid: String) -> Result<NovelContent, String> {
    let id = parse_id(&aid)?;
    let chapterid = parse_id(&cid)?;
    let v = get_api_json(
        "chapter",
        &format!(r#"{{"id":{id},"chapterid":{chapterid}}}"#),
    )
    .await?;
    let text = normalize_text(&value_str(v.get("txt")));
    if text.is_empty() {
        return Err("笔趣阁返回的章节正文为空，可稍后重试".to_string());
    }
    Ok(NovelContent {
        text,
        images: Vec::new(),
    })
}
