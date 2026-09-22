//! 进程内调用桥接层（本项目新增，上游 MD3Music 无此文件）。
//!
//! 上游把模块路由表架在 tiny_http 之上，通过 127.0.0.1 随机端口给客户端用。
//! 本项目是 Tauri 应用，前端一律经 `invoke` 调 Rust 命令，不开本地端口、不走
//! CORS，因此这里复用 server.rs 的同一套语义——「cookie 注入 → query 组装 →
//! 路由分发」——把结果直接交给宿主命令层。
//!
//! 与 server.rs 的对应关系（必须保持一致，否则行为会偏离上游）：
//!   1. cookie 注入：`parse_express_cookies` + 六个 `ensure_cookie`，顺序同上游；
//!   2. query 组装：cookie 合并为对象、参数平铺、`cookie` 字符串参数解析后并入；
//!   3. 路由匹配：`prefix_match`（Express 的路径段前缀语义）；
//!   4. `/register/dev` 成功（status=200）时持久化 dfid/mid。
//!
//! 有意未复制的只有 HTTP 专属部分：CORS/OPTIONS、apicache、octet-stream 请求体
//! 透传（`/audio/match` 的 PCM，本项目用不到）。

use crate::device::DeviceConfig;
use crate::modules::Ctx;
use crate::request::ModuleResponse;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

static INIT: OnceLock<()> = OnceLock::new();

/// 初始化：登记持久化目录 + 载入（或生成并落盘）设备身份。
///
/// 必须在任何 [`call`] 之前调用一次。等价上游 `server::start` 的副作用
/// （`DATA_DIR` 写入 + `DeviceConfig::load_cached`）。
pub fn init(data_dir: &str) {
    INIT.get_or_init(|| {
        crate::server::set_data_dir(data_dir.to_string());
        let dev = DeviceConfig::instance();
        let loaded = dev.load_cached(data_dir);
        dev.init_device_info();
        if !loaded {
            // 首次运行：立刻落盘。否则每次启动都会生成新的 guid/mid，
            // 上游会视为一台全新设备（累积设备记录 + 触发风控）。
            dev.save(data_dir, &dev.get_dfid(), None);
        }
    });
}

/// 一次模块调用的结果。
pub struct BridgeResult {
    pub status: u16,
    /// 响应体（JSON 文本，或二进制原文的 UTF-8 损失转换）。
    pub body: String,
    /// 需要写回调用方的 cookie，`k=v` 形式（已剥掉 `; PATH=/` 等属性）。
    pub cookies: Vec<String>,
    /// 模块自带的响应头。
    pub headers: Vec<(String, String)>,
}

/// 调用一个酷狗接口。
///
/// - `path`：路由路径，如 `/login/qr/create`（可带 query，但参数请走 `params`）。
/// - `params`：平铺的请求参数对象。可含两个特殊键：
///   - `"cookie"`：`k=v; k=v` 字符串或对象，解析后并入 cookie jar；
///   - `"body"`：模块需要的请求体对象（youth 系列的 `body_or_param` 会读）。
/// - `cookie_header`：调用方持久化的 cookie（`k=v; k=v`），可为空。
pub fn call(path: &str, params: &Value, cookie_header: &str) -> BridgeResult {
    let (path_only, _) = match path.find('?') {
        Some(i) => (&path[..i], &path[i + 1..]),
        None => (path, ""),
    };

    // ---- 1. cookie：解析 + 平台 cookie 注入 ----
    let mut cookies: Map<String, Value> = Map::new();
    if !cookie_header.trim().is_empty() {
        crate::server::parse_express_cookies(cookie_header, &mut cookies);
    }
    let suffix = "; PATH=/";
    let mut injected: Vec<String> = Vec::new();
    crate::server::ensure_cookie(
        &mut cookies,
        "KUGOU_API_PLATFORM",
        "undefined",
        suffix,
        &mut injected,
    );
    crate::server::ensure_cookie(
        &mut cookies,
        "KUGOU_API_MID",
        &crate::server::session_mid(),
        suffix,
        &mut injected,
    );
    crate::server::ensure_cookie(
        &mut cookies,
        "KUGOU_API_GUID",
        &crate::server::session_guid(),
        suffix,
        &mut injected,
    );
    crate::server::ensure_cookie(
        &mut cookies,
        "KUGOU_API_DEV",
        &crate::server::session_dev(),
        suffix,
        &mut injected,
    );
    // 持久化 dfid 兜底：新建/删除歌单等写操作依赖 dfid cookie，降级为 "-" 会被
    // 上游风控拒绝（详见 server.rs 同名逻辑）。
    let dfid = DeviceConfig::instance().get_dfid();
    if !dfid.is_empty() && dfid != "-" {
        crate::server::ensure_cookie(&mut cookies, "dfid", &dfid, suffix, &mut injected);
    }
    crate::server::ensure_cookie(
        &mut cookies,
        "KUGOU_API_MAC",
        "02:00:00:00:00:00",
        suffix,
        &mut injected,
    );

    // ---- 2. query：参数平铺 + cookie 合并为对象 ----
    let mut query: Map<String, Value> = Map::new();
    if let Some(o) = params.as_object() {
        for (k, v) in o {
            if k != "cookie" {
                query.insert(k.clone(), v.clone());
            }
        }
        match o.get("cookie") {
            Some(Value::String(cs)) => {
                let decoded = crate::util::percent_decode_preserve_plus(cs);
                if let Some(m) = crate::server::cookie_to_json(&decoded).as_object() {
                    for (k, v) in m {
                        cookies.insert(k.clone(), v.clone());
                    }
                }
            }
            Some(Value::Object(m)) => {
                for (k, v) in m {
                    cookies.insert(k.clone(), v.clone());
                }
            }
            _ => {}
        }
    }
    query.insert("cookie".to_string(), Value::Object(cookies));
    let query = Value::Object(query);

    // ---- 3. 路由分发 ----
    for (route, module_fn) in crate::server::routes() {
        if !crate::server::prefix_match(route, path_only) {
            continue;
        }
        let ctx = Ctx {
            ip: String::new(),
            body_bytes: None,
        };
        let mr: ModuleResponse = module_fn(&query, &ctx).unwrap_or_else(|e| e);
        if *route == "/register/dev" && mr.status == 200 {
            crate::server::persist_registered_device(&mr.body);
        }
        return BridgeResult {
            status: mr.status,
            body: mr.body.to_string_utf8(),
            // 先注入后模块：模块返回的登录 cookie 覆盖注入值
            cookies: normalize_cookies(&injected, &mr.cookie),
            headers: mr.headers.into_iter().collect(),
        };
    }

    BridgeResult {
        status: 404,
        body: json!({ "status": 0, "msg": format!("未知的酷狗路由：{path_only}") }).to_string(),
        cookies: Vec::new(),
        headers: Vec::new(),
    }
}

/// 把一条 `k=v; PATH=/` 形式的 cookie 归一化后写入列表，同键覆盖。
fn upsert_cookie(list: &mut Vec<(String, String)>, raw: &str) {
    let first = raw.split(';').next().unwrap_or("").trim();
    let Some(i) = first.find('=') else {
        return;
    };
    let key = first[..i].trim();
    if key.is_empty() {
        return;
    }
    let val = first[i + 1..].trim().to_string();
    // 先取下标再改列表：直接 match find() 的 &mut 返回值会让 None 分支无法再借用 list
    match list.iter().position(|(k, _)| k.as_str() == key) {
        Some(idx) => list[idx].1 = val,
        None => list.push((key.to_string(), val)),
    }
}

/// 合并两侧 cookie 并剥掉属性段，输出 `k=v` 列表。
pub(crate) fn normalize_cookies(injected: &[String], from_module: &[String]) -> Vec<String> {
    let mut list: Vec<(String, String)> = Vec::new();
    for c in injected.iter().chain(from_module.iter()) {
        upsert_cookie(&mut list, c);
    }
    list.into_iter().map(|(k, v)| format!("{k}={v}")).collect()
}
