//! Bangumi.tv 集成：授权（粘贴 access_token）+ 追番列表同步 + 追番状态更新。
//!
//! 设计取舍：Bangumi OAuth 需要在开放平台注册 client_id 才能走标准
//! webview OAuth 流程。为避免引入硬编码 client_id 和 deep link 配置，
//! 采用**粘贴 access_token** 授权：用户在 https://api.bgm.tv/consumer
//! 自己注册应用获取 Personal Access Token，粘贴到设置页即可。
//! 这条通路对桌面端最简洁，且与 Kazumi 等同类工具一致。
//!
//! API 参考：
//!   https://api.bgm.tv/v0/me
//!   https://api.bgm.tv/v0/users/{username}/collections?subject_type=2&limit=50&offset=0
//!   POST https://api.bgm.tv/v0/users/-/collections/{subject_id}
//!

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use tauri::Manager;

const PERSIST_FILE: &str = "bangumi.json";
const API_DOMAIN: &str = "https://api.bgm.tv";
const USER_AGENT: &str = "LumiLuna/1.2 (desktop)";

static STATE: OnceLock<Mutex<BangumiPersist>> = OnceLock::new();

fn state() -> &'static Mutex<BangumiPersist> {
    STATE.get_or_init(|| Mutex::new(BangumiPersist::default()))
}

fn client() -> Client {
    Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_default()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct BangumiPersist {
    #[serde(default)]
    access_token: String,
    #[serde(default)]
    username: String,
    #[serde(default)]
    nickname: String,
}

fn persist_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    std::fs::create_dir_all(&dir).ok();
    dir.join(PERSIST_FILE)
}

fn load_persist(app: &tauri::AppHandle) -> BangumiPersist {
    let path = persist_path(app);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str::<BangumiPersist>(&s).ok())
        .unwrap_or_default()
}

fn save_persist(app: &tauri::AppHandle, p: &BangumiPersist) -> Result<(), String> {
    let path = persist_path(app);
    let json = serde_json::to_string_pretty(p).map_err(|e| e.to_string())?;
    std::fs::write(path, json).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
struct BangumiMe {
    id: i64,
    #[serde(default)]
    username: String,
    #[serde(default)]
    nickname: String,
}

/// 追番状态（Bangumi collection type）
/// 1=想看 plan_to_watch, 2=看过 watched, 3=在看 watching, 4=搁置 on_hold, 5=抛弃 abandoned
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BangumiCollectionType {
    PlanToWatch = 1,
    Watched = 2,
    Watching = 3,
    OnHold = 4,
    Abandoned = 5,
}

impl BangumiCollectionType {
    pub fn value(self) -> i64 {
        self as i64
    }
}

#[derive(Debug, Deserialize)]
struct BangumiCollectionEntry {
    #[serde(rename = "subject_id")]
    subject_id: i64,
    #[serde(rename = "subject_type")]
    subject_type: i64,
    #[serde(rename = "type")]
    collection_type: i64,
    #[serde(default)]
    name: String,
    #[serde(rename = "name_cn", default)]
    name_cn: String,
    #[serde(default)]
    eps: i64,
    #[serde(rename = "watched_eps", default)]
    watched_eps: i64,
    #[serde(default)]
    score: i64,
    #[serde(default)]
    rank: i64,
    #[serde(default)]
    private: bool,
    #[serde(rename = "updated_at")]
    updated_at: i64,
    #[serde(rename = "created_at")]
    created_at: i64,
    #[serde(rename = "last_ep")]
    last_ep: Option<i64>,
    #[serde(rename = "tags", default)]
    tags: Vec<String>,
    subject: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct BangumiCollectionPage {
    total: i64,
    limit: i64,
    offset: i64,
    #[serde(default)]
    data: Vec<BangumiCollectionEntry>,
}

// =====================================================================
// 公开命令
// =====================================================================

/// 设置 access_token：验证有效性后持久化，返回用户信息。
#[tauri::command]
pub fn bangumi_set_token(
    app: tauri::AppHandle,
    token: String,
) -> Result<BangumiAuthInfo, String> {
    if token.trim().is_empty() {
        return Err("access_token 不能为空".into());
    }
    let user = fetch_me(&token)?;
    let persist = BangumiPersist {
        access_token: token.clone(),
        username: user.username.clone(),
        nickname: if !user.nickname.is_empty() {
            user.nickname.clone()
        } else {
            user.username.clone()
        },
    };
    save_persist(&app, &persist)?;
    *state().lock().unwrap() = persist;
    Ok(BangumiAuthInfo {
        username: user.username,
        nickname: user.nickname,
    })
}

/// 读取本地授权状态（不触发网络请求）。
#[tauri::command]
pub fn bangumi_get_status(app: tauri::AppHandle) -> BangumiAuthInfo {
    let p = load_persist(&app);
    BangumiAuthInfo {
        username: p.username,
        nickname: p.nickname,
    }
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BangumiAuthInfo {
    pub username: String,
    pub nickname: String,
}

/// 登出：清 token 和本地追番缓存。
#[tauri::command]
pub fn bangumi_logout(app: tauri::AppHandle) -> Result<(), String> {
    let persist = BangumiPersist::default();
    save_persist(&app, &persist)?;
    *state().lock().unwrap() = persist;
    clear_local_collections(&app)?;
    Ok(())
}

/// 从 Bangumi API 拉取全部追番，分页并保存到本地 SQLite 表。
#[tauri::command]
pub fn bangumi_sync_collections(
    app: tauri::AppHandle,
) -> Result<BangumiSyncResult, String> {
    let persist = load_persist(&app);
    if persist.access_token.is_empty() {
        return Err("Bangumi 未授权".into());
    }
    let username = if persist.username.is_empty() {
        // 首次授权可能没 username，用 me 接口补齐
        let me = fetch_me(&persist.access_token)?;
        save_persist(
            &app,
            &BangumiPersist {
                username: me.username.clone(),
                nickname: me.nickname.clone(),
                ..persist.clone()
            },
        )?;
        me.username
    } else {
        persist.username.clone()
    };
    let mut offset = 0;
    let limit = 50;
    let mut total = 0;
    let mut collected: Vec<BangumiCollectionEntry> = Vec::new();
    loop {
        let page = fetch_collections_page(&persist.access_token, &username, limit, offset)?;
        if offset == 0 {
            total = page.total;
        }
        let done = page.data.len();
        collected.extend(page.data);
        if done < limit || collected.len() as i64 >= total {
            break;
        }
        offset += done as i64;
        // 礼貌节流
        std::thread::sleep(Duration::from_millis(250));
    }
    replace_local_collections(&app, &collected)?;
    Ok(BangumiSyncResult {
        total,
        saved: collected.len() as i64,
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BangumiSyncResult {
    pub total: i64,
    pub saved: i64,
}

/// 设置单条条目的追番状态（PATCH /v0/users/-/collections/{subject_id}）。
#[tauri::command]
pub fn bangumi_set_collection(
    app: tauri::AppHandle,
    subject_id: i64,
    collection_type: i64,
    watched_eps: Option<i64>,
    rating: Option<i64>,
) -> Result<(), String> {
    let persist = load_persist(&app);
    if persist.access_token.is_empty() {
        return Err("Bangumi 未授权".into());
    }
    if collection_type < 1 || collection_type > 5 {
        return Err("collection_type 必须是 1-5".into());
    }
    let mut body = serde_json::json!({
        "type": collection_type,
    });
    if let Some(eps) = watched_eps {
        body["eps"] = serde_json::json!(eps);
    }
    if let Some(r) = rating {
        if r > 0 {
            body["rating"] = serde_json::json!(r);
        }
    }
    let url = format!("{API_DOMAIN}/v0/users/-/collections/{subject_id}");
    let resp = client()
        .patch(&url)
        .header("Authorization", format!("Bearer {}", persist.access_token))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let msg = resp.text().unwrap_or_default();
        return Err(format!("Bangumi set collection 失败: {} {}", status, msg));
    }
    // 更新本地镜像（先删后插）
    upsert_local_collection(&app, subject_id, collection_type, watched_eps)?;
    Ok(())
}

/// 查询本地镜像中某个条目的追番状态（用于详情页显示按钮状态）。
#[tauri::command]
pub fn bangumi_get_local_collection(
    app: tauri::AppHandle,
    subject_id: i64,
) -> Option<BangumiLocalCollectionRow> {
    query_local_collection(&app, subject_id).ok().flatten()
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BangumiLocalCollectionRow {
    pub subject_id: i64,
    pub collection_type: i64,
    pub watched_eps: i64,
    pub rating: i64,
    pub updated_at: i64,
}

// =====================================================================
// HTTP 辅助
// =====================================================================

fn fetch_me(token: &str) -> Result<BangumiMe, String> {
    let url = format!("{API_DOMAIN}/v0/me");
    let resp = client()
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Bangumi token 验证失败: {}", resp.status()));
    }
    let body = resp.text().map_err(|e| e.to_string())?;
    serde_json::from_str::<BangumiMe>(&body).map_err(|e| e.to_string())
}

fn fetch_collections_page(
    token: &str,
    username: &str,
    limit: i64,
    offset: i64,
) -> Result<BangumiCollectionPage, String> {
    let url = format!(
        "{API_DOMAIN}/v0/users/{username}/collections?subject_type=2&limit={limit}&offset={offset}"
    );
    let resp = client()
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    if !status.is_success() {
        let msg = resp.text().unwrap_or_default();
        return Err(format!("Bangumi collections 请求失败: {status} {msg}"));
    }
    let body = resp.text().map_err(|e| e.to_string())?;
    serde_json::from_str::<BangumiCollectionPage>(&body).map_err(|e| e.to_string())
}

// =====================================================================
// 本地 SQLite 镜像表（bangumi_collections）
// =====================================================================

fn ensure_table(app: &tauri::AppHandle) -> Result<(), String> {
    use crate::commands::DbState;
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        r#"CREATE TABLE IF NOT EXISTS bangumi_collections (
             subject_id      INTEGER PRIMARY KEY,
             collection_type INTEGER NOT NULL DEFAULT 1,
             watched_eps     INTEGER NOT NULL DEFAULT 0,
             rating          INTEGER NOT NULL DEFAULT 0,
             name            TEXT NOT NULL DEFAULT '',
             name_cn         TEXT NOT NULL DEFAULT '',
             cover           TEXT,
             updated_at      INTEGER NOT NULL DEFAULT 0,
             synced_at       INTEGER NOT NULL DEFAULT (strftime('%s','now'))
           )"#,
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn replace_local_collections(
    app: &tauri::AppHandle,
    items: &[BangumiCollectionEntry],
) -> Result<(), String> {
    use crate::commands::DbState;
    ensure_table(app)?;
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM bangumi_collections", [])
        .map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().timestamp();
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for item in items {
        let cover = item
            .subject
            .as_ref()
            .and_then(|s| s.get("images"))
            .and_then(|m| m.get("large"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        tx.execute(
            r#"INSERT OR REPLACE INTO bangumi_collections
               (subject_id, collection_type, watched_eps, rating, name, name_cn, cover, updated_at, synced_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
            rusqlite::params![
                item.subject_id,
                item.collection_type,
                item.watched_eps,
                item.score,
                item.name,
                item.name_cn,
                cover,
                item.updated_at,
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_local_collection(
    app: &tauri::AppHandle,
    subject_id: i64,
    collection_type: i64,
    watched_eps: Option<i64>,
) -> Result<(), String> {
    use crate::commands::DbState;
    ensure_table(app)?;
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let existing: (i64, i64) = conn
        .query_row(
            "SELECT watched_eps, rating FROM bangumi_collections WHERE subject_id = ?1",
            rusqlite::params![subject_id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)),
        )
        .unwrap_or((0, 0));
    let eps = watched_eps.unwrap_or(existing.0);
    let now = chrono::Utc::now().timestamp();
    conn.execute(
        r#"INSERT OR REPLACE INTO bangumi_collections
           (subject_id, collection_type, watched_eps, rating, name, name_cn, updated_at, synced_at)
           VALUES (?1, ?2, ?3, ?4, '', '', ?5, ?6)"#,
        rusqlite::params![
            subject_id,
            collection_type,
            eps,
            existing.1,
            now,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn query_local_collection(
    app: &tauri::AppHandle,
    subject_id: i64,
) -> Result<Option<BangumiLocalCollectionRow>, String> {
    use crate::commands::DbState;
    ensure_table(app)?;
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT subject_id, collection_type, watched_eps, rating, updated_at \
             FROM bangumi_collections WHERE subject_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let row = stmt
        .query_row(rusqlite::params![subject_id], |r| {
            Ok(BangumiLocalCollectionRow {
                subject_id: r.get(0)?,
                collection_type: r.get(1)?,
                watched_eps: r.get(2)?,
                rating: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })
        .ok();
    Ok(row)
}

fn clear_local_collections(app: &tauri::AppHandle) -> Result<(), String> {
    use crate::commands::DbState;
    ensure_table(app)?;
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM bangumi_collections", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
