//! 在线小说模块：抓取 Wenku8 轻小说文库 HTML 并解析为结构化数据。
//!
//! 移植自参考项目（Flutter Hikari Novel）：
//! - 节点：www.wenku8.net / www.wenku8.cc
//! - 编码：GBK / Big5（encoding_rs）
//! - 解析：scraper（Rust HTML DOM）
//! 书架 / 进度 / 章节缓存 / 阅读统计均落在本地 SQLite。

use regex::Regex;use reqwest::blocking::Client;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::{now_ms, DbState};

// ---- 常量 ----

const NODE_CC: &str = "https://www.wenku8.cc";
const NODE_NET: &str = "https://www.wenku8.net";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0";

// ---- 请求 / 响应结构（与前端 TS 一一对应）----

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelCover {
    pub aid: String,
    pub title: String,
    pub image_url: String,
    pub author: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelDetail {
    pub aid: String,
    pub title: String,
    pub author: String,
    pub status: String,
    pub fin_update: String,
    pub img_url: String,
    pub introduce: String,
    pub tags: Vec<String>,
    pub heat: String,
    pub trending: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelChapter {
    pub cid: String,
    pub title: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelVolume {
    pub title: String,
    pub chapters: Vec<NovelChapter>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelContent {
    pub text: String,
    pub images: Vec<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelRecommendBlock {
    pub title: String,
    pub novels: Vec<NovelCover>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelShelfItem {
    pub aid: String,
    pub title: String,
    pub author: String,
    pub cover: String,
    pub added_at: i64,
    /// true 表示来自 Wenku8 在线账号书架，false 为本地收藏
    pub online: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelProgress {
    pub aid: String,
    pub cid: String,
    pub chapter_title: String,
    pub position: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NovelReadSessionStart {
    pub id: String,
    pub book_id: String,
    pub source: String,
    pub title: String,
    pub chapter_key: String,
    pub chapter_title: String,
    pub started_at: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NovelReadSessionEnd {
    pub id: String,
    pub book_id: String,
    pub source: String,
    pub title: String,
    pub chapter_key: String,
    pub chapter_title: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub completed: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelDailyStat {
    pub day: String,
    pub read_count: i64,
    pub total_ms: i64,
    pub unique_books: i64,
    pub local_ms: i64,
    pub online_ms: i64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelSourceStat {
    pub source: String,
    pub read_count: i64,
    pub total_ms: i64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NovelTopBook {
    pub book_id: String,
    pub source: String,
    pub title: String,
    pub chapter_title: String,
    pub read_count: i64,
    pub total_ms: i64,
}

// ---- HTTP 工具 ----

fn client() -> Client {
    Client::builder()
        .no_proxy()
        .user_agent(UA)
        .build()
        .expect("novel http client")
}

fn node_url(node: &str) -> &'static str {
    if node == "net" {
        NODE_NET
    } else {
        NODE_CC
    }
}

/// 抓取 HTML 并按 charset 解码为字符串。
/// 若已登录，自动注入 Wenku8 cookie（覆盖 .net / .cc 双节点）。
pub(crate) fn fetch_html(
    app: &tauri::AppHandle,
    node: &str,
    charset: &str,
    path: &str,
) -> Result<String, String> {
    let base = node_url(node).to_string();
    let mut url = format!("{base}{path}");
    if !url.contains('?') {
        url.push('?');
    } else {
        url.push('&');
    }
    url.push_str(if charset == "big5" { "charset=big5" } else { "charset=gbk" });

    let cookie = crate::novel_auth::current_cookie(app);
    let mut req = client().get(&url);
    if let Some(c) = cookie {
        req = req.header(reqwest::header::COOKIE, c);
    }

    let resp = req
        .send()
        .map_err(|e| format!("网络请求失败：{e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!(
            "Wenku8 返回 HTTP {}，可能被站点拦截，可尝试切换节点或稍后再试",
            status.as_u16()
        ));
    }
    let bytes = resp
        .bytes()
        .map_err(|e| format!("读取响应失败：{e}"))?;

    let (text, _, _) = if charset == "big5" {
        encoding_rs::BIG5.decode(&bytes)
    } else {
        encoding_rs::GBK.decode(&bytes)
    };
    Ok(text.into_owned())
}

fn normalize_image(src: &str, base: &str) -> String {
    let src = src.trim();
    if src.is_empty() {
        return format!("{base}/modules/article/images/nocover.jpg");
    }
    if src.starts_with("http") {
        src.to_string()
    } else if src == "/images/noimg.jpg" {
        format!("{base}/modules/article/images/nocover.jpg")
    } else {
        format!("{base}{}", src.trim_start_matches('/'))
    }
}

/// 从 href 提取 aid。
fn extract_aid(href: &str) -> String {
    if let Some(idx) = href.find("book/") {
        let rest = &href[idx + 5..];
        if let Some(end) = rest.find(".htm") {
            return rest[..end].to_string();
        }
    }
    if let Some(idx) = href.find("aid=") {
        let rest = &href[idx + 4..];
        let end = rest.find('&').unwrap_or(rest.len());
        return rest[..end].to_string();
    }
    String::new()
}

// ---- 解析：列表 ----

fn parse_list(html: &str, base: &str) -> Vec<NovelCover> {
    let doc = Html::parse_document(html);
    let content_sel = Selector::parse("#content").ok();
    let Some(content) = content_sel.and_then(|s| doc.select(&s).next()) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // 首选：参考项目的固定布局
    if let Ok(item_sel) = Selector::parse(r#"div[style="width:373px;height:136px;float:left;margin:5px 0px 5px 5px;"]"#) {
        let img_sel = Selector::parse("img").ok();
        let a_sel = Selector::parse("a").ok();
        for item in content.select(&item_sel) {
            let img = img_sel
                .as_ref()
                .and_then(|s| item.select(s).next())
                .and_then(|e| e.value().attr("src"))
                .map(|s| normalize_image(s, base))
                .unwrap_or_default();

            let mut title = String::new();
            let mut href = String::new();
            if let Some(a_sel) = &a_sel {
                for a in item.select(a_sel) {
                    if title.is_empty() {
                        title = a.value().attr("title").unwrap_or("").trim().to_string();
                    }
                    let h = a.value().attr("href").unwrap_or("").to_string();
                    if h.contains("book/") || h.contains("aid=") {
                        href = h;
                    }
                }
            }
            let aid = extract_aid(&href);
            if !title.is_empty() && !aid.is_empty() && seen.insert(aid.clone()) {
                out.push(NovelCover {
                    aid,
                    title,
                    image_url: img,
                    author: None,
                });
            }
        }
    }

    // 回退：Wenku8 改版或样式不匹配时，从 #content 内 book/xxx.htm 链接兜底
    if out.is_empty() {
        if let Ok(a_sel) = Selector::parse(r#"a[href*="book/"]"#) {
            for a in content.select(&a_sel) {
                let href = a.value().attr("href").unwrap_or("").to_string();
                let aid = extract_aid(&href);
                if aid.is_empty() {
                    continue;
                }
                let title = a
                    .value()
                    .attr("title")
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        let text = a.text().collect::<Vec<_>>().join("").trim().to_string();
                        if text.is_empty() { None } else { Some(text) }
                    })
                    .unwrap_or_default();
                if title.is_empty() || !seen.insert(aid.clone()) {
                    continue;
                }
                out.push(NovelCover {
                    aid,
                    title,
                    image_url: format!("{base}/modules/article/images/nocover.jpg"),
                    author: None,
                });
            }
        }
    }

    out
}

// ---- 解析：详情 ----

fn parse_detail(html: &str, aid: &str, base: &str) -> Result<NovelDetail, String> {
    let doc = Html::parse_document(html);
    let content_sel = Selector::parse("#content").ok();
    let content = content_sel
        .and_then(|s| doc.select(&s).next())
        .ok_or_else(|| "详情页缺少 #content".to_string())?;

    let title_sel = Selector::parse("span > b").ok();
    let title = title_sel
        .and_then(|s| content.select(&s).next())
        .map(|e| e.text().collect::<Vec<_>>().join("").trim().to_string())
        .unwrap_or_default();

    let tr_sel = Selector::parse("tr").ok();
    let td_sel = Selector::parse("td").ok();
    let mut author = String::new();
    let mut status = String::new();
    let mut fin_update = String::new();
    if let (Some(tr_sel), Some(td_sel)) = (&tr_sel, &td_sel) {
        let trs: Vec<_> = content.select(tr_sel).collect();
        if trs.len() >= 3 {
            let tds: Vec<_> = trs[2].select(td_sel).collect();
            if tds.len() >= 4 {
                author = tds[1].text().collect::<Vec<_>>().join("").trim().to_string();
                status = tds[2].text().collect::<Vec<_>>().join("").trim().to_string();
                fin_update = tds[3].text().collect::<Vec<_>>().join("").trim().to_string();
                if author.len() > 5 { author = author[5..].to_string(); }
                if status.len() > 5 { status = status[5..].to_string(); }
                if fin_update.len() > 5 { fin_update = fin_update[5..].to_string(); }
            }
        }
    }

    let img_sel = Selector::parse("img").ok();
    let img_url = img_sel
        .and_then(|s| content.select(&s).next())
        .and_then(|e| e.value().attr("src"))
        .map(|s| normalize_image(s, base))
        .unwrap_or_default();

    // 简介与标签（尽力解析：第二张表的第二个 td 里的 span）
    let mut introduce = String::new();
    let mut tags: Vec<String> = Vec::new();
    let table_sel = Selector::parse("table").ok();
    let span_sel = Selector::parse("span").ok();
    if let (Some(table_sel), Some(span_sel)) = (&table_sel, &span_sel) {
        let tables: Vec<_> = content.select(table_sel).collect();
        if tables.len() >= 3 {
            let tds: Vec<_> = tables[2].select(td_sel.as_ref().unwrap()).collect();
            if tds.len() >= 2 {
                let spans: Vec<_> = tds[1].select(span_sel).collect();
                if spans.len() >= 6 {
                    introduce = spans[5].text().collect::<Vec<_>>().join("\n").trim().to_string();
                }
                if let Some(first) = spans.first() {
                    let raw = first.text().collect::<Vec<_>>().join("").trim().to_string();
                    tags = raw
                        .split_whitespace()
                        .map(|s| s.to_string())
                        .filter(|s| !s.is_empty() && !s.starts_with("标签"))
                        .collect();
                }
            }
        }
    }

    Ok(NovelDetail {
        aid: aid.to_string(),
        title,
        author,
        status,
        fin_update,
        img_url,
        introduce,
        tags,
        heat: String::new(),
        trending: String::new(),
    })
}

// ---- 解析：目录 ----

fn parse_catalogue(html: &str) -> Vec<NovelVolume> {
    let doc = Html::parse_document(html);
    let table_sel = Selector::parse("table.css").ok();
    let Some(table_sel) = table_sel else { return Vec::new() };
    let Some(table) = doc.select(&table_sel).next() else { return Vec::new() };

    let tr_sel = Selector::parse("tr").ok();
    let vcss_sel = Selector::parse("td.vcss").ok();
    let ccss_sel = Selector::parse("td.ccss a").ok();
    let (Some(tr_sel), Some(vcss_sel), Some(ccss_sel)) = (tr_sel, vcss_sel, ccss_sel) else {
        return Vec::new();
    };

    let mut volumes: Vec<NovelVolume> = Vec::new();
    let mut current_title: Option<String> = None;
    let mut chapters: Vec<NovelChapter> = Vec::new();

    for row in table.select(&tr_sel) {
        if let Some(v) = row.select(&vcss_sel).next() {
            if let Some(title) = current_title.take() {
                volumes.push(NovelVolume { title, chapters: std::mem::take(&mut chapters) });
            }
            current_title = Some(v.text().collect::<Vec<_>>().join("").trim().to_string());
            continue;
        }
        for a in row.select(&ccss_sel) {
            let title = a.text().collect::<Vec<_>>().join("").trim().to_string();
            let href = a.value().attr("href").unwrap_or("").to_string();
            let cid = href
                .split("cid=")
                .nth(1)
                .map(|s| s.to_string())
                .unwrap_or_default();
            if title.is_empty() || cid.is_empty() {
                continue;
            }
            chapters.push(NovelChapter { cid, title });
        }
    }
    if let Some(title) = current_title.take() {
        volumes.push(NovelVolume { title, chapters });
    }
    volumes
}

// ---- 解析：正文 ----

fn parse_content(html: &str, base: &str) -> NovelContent {
    // 去掉目录导航 ul#contentdp
    let re = Regex::new(r#"(?is)<ul\s+id=["']contentdp["'][^>]*>.*?</ul>"#).unwrap();
    let html = re.replace_all(html, "").into_owned();
    let doc = Html::parse_document(&html);
    let content_sel = Selector::parse("#content").ok();
    let Some(content) = content_sel.and_then(|s| doc.select(&s).next()) else {
        return NovelContent::default();
    };

    let img_sel = Selector::parse("img").ok();
    let images = img_sel
        .map(|s| {
            content
                .select(&s)
                .filter_map(|e| e.value().attr("src"))
                .map(|src| normalize_image(src, base))
                .collect()
        })
        .unwrap_or_default();

    let raw = content.text().collect::<Vec<_>>().join("");
    let trimmed = raw.trim().to_string();
    let paragraphs: Vec<String> = trimmed
        .split("\n\n")
        .map(|p| {
            let t = p.trim();
            if t.is_empty() {
                String::new()
            } else {
                let mut lines: Vec<String> = p.lines().map(|l| l.to_string()).collect();
                if let Some(first) = lines.first_mut() {
                    first.insert_str(0, "   ");
                }
                lines.join("\n")
            }
        })
        .filter(|p| !p.is_empty())
        .collect();
    let text = paragraphs.join("\n\n");
    // 去掉文本里残留的图片 URL
    let text = text.trim().to_string();

    NovelContent { text, images }
}

// ---- 解析：推荐页 ----

fn parse_recommend(html: &str, base: &str) -> Vec<NovelRecommendBlock> {
    let doc = Html::parse_document(html);
    let block_sel = Selector::parse(".block").ok();
    let title_sel = Selector::parse(".blocktitle").ok();
    let item_sel = Selector::parse(r#"div[style="float: left;text-align:center;width: 95px; height:155px;overflow:hidden;"]"#).ok();
    let a_sel = Selector::parse("a").ok();
    let img_sel = Selector::parse("img").ok();
    let (Some(block_sel), Some(title_sel), Some(item_sel), Some(a_sel), Some(img_sel)) =
        (block_sel, title_sel, item_sel, a_sel, img_sel)
    else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for (i, block) in doc.select(&block_sel).enumerate() {
        if i == 0 {
            continue;
        }
        let title = block
            .select(&title_sel)
            .next()
            .map(|e| e.text().collect::<Vec<_>>().join("").trim().to_string())
            .unwrap_or_default();
        let mut novels = Vec::new();
        for item in block.select(&item_sel) {
            let img = item
                .select(&img_sel)
                .next()
                .and_then(|e| e.value().attr("src"))
                .map(|s| normalize_image(s, base))
                .unwrap_or_default();
            let links: Vec<_> = item.select(&a_sel).collect();
            if links.len() < 2 {
                continue;
            }
            let title = links[1].text().collect::<Vec<_>>().join("").trim().to_string();
            let href = links[0].value().attr("href").unwrap_or("").to_string();
            let aid = extract_aid(&href);
            if title.is_empty() || aid.is_empty() {
                continue;
            }
            novels.push(NovelCover {
                aid,
                title,
                image_url: img,
                author: None,
            });
        }
        if !title.is_empty() || !novels.is_empty() {
            out.push(NovelRecommendBlock { title, novels });
        }
    }
    out
}

// ---- 日期工具（与 stats.rs 对齐）----

fn today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

fn epoch_ms_to_day(ms: i64) -> String {
    let secs = ms / 1000;
    let days = secs / 86_400;
    let naive = chrono::NaiveDate::from_ymd_opt(1970, 1, 1)
        .unwrap()
        .checked_add_signed(chrono::Duration::days(days as i64))
        .unwrap_or_default();
    naive.format("%Y-%m-%d").to_string()
}

// ---- 书架 / 进度 / 缓存 命令 ----

#[tauri::command]
pub fn novel_shelf_list(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<Vec<NovelShelfItem>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let mut stmt = conn
        .prepare("SELECT aid, title, author, cover, added_at FROM novel_shelf ORDER BY added_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(NovelShelfItem {
                aid: row.get(0)?,
                title: row.get(1)?,
                author: row.get(2)?,
                cover: row.get(3)?,
                added_at: row.get(4)?,
                online: false,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    drop(conn);

    // 已登录则合并 Wenku8 在线书架（参考项目：bookcase.php）
    if let Some(cookie) = crate::novel_auth::current_cookie(&app) {
        if !cookie.is_empty() {
            if let Ok(online) = crate::novel_auth::wenku8_shelf_online(app, "net".to_string()) {
                // 在线项去重：本地已存在的 aid 不再重复
                let local_ids: std::collections::HashSet<String> =
                    out.iter().map(|i| i.aid.clone()).collect();
                for item in online {
                    if !local_ids.contains(&item.aid) {
                        out.push(item);
                    }
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn novel_shelf_add(
    state: State<'_, DbState>,
    aid: String,
    title: String,
    author: Option<String>,
    cover: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO novel_shelf (aid, title, author, cover, added_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![aid, title, author.unwrap_or_default(), cover.unwrap_or_default(), now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn novel_shelf_remove(state: State<'_, DbState>, aid: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    conn.execute("DELETE FROM novel_shelf WHERE aid = ?1", rusqlite::params![aid])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn novel_progress_get(
    state: State<'_, DbState>,
    aid: String,
) -> Result<Option<NovelProgress>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let row = conn.query_row(
        "SELECT aid, cid, chapter_title, position, updated_at FROM novel_progress WHERE aid = ?1",
        rusqlite::params![aid],
        |row| {
            Ok(NovelProgress {
                aid: row.get(0)?,
                cid: row.get(1)?,
                chapter_title: row.get(2)?,
                position: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    );
    match row {
        Ok(p) => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn novel_progress_set(
    state: State<'_, DbState>,
    aid: String,
    cid: String,
    chapter_title: String,
    position: i64,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO novel_progress (aid, cid, chapter_title, position, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![aid, cid, chapter_title, position, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn novel_chapter_cache_get(
    state: State<'_, DbState>,
    aid: String,
    cid: String,
) -> Result<Option<NovelContent>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let row = conn.query_row(
        "SELECT content FROM novel_chapter_cache WHERE aid = ?1 AND cid = ?2",
        rusqlite::params![aid, cid],
        |row| {
            let json: String = row.get(0)?;
            serde_json::from_str::<NovelContent>(&json).map_err(|_| rusqlite::Error::InvalidQuery)
        },
    );
    match row {
        Ok(content) => Ok(Some(content)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn novel_chapter_cache_put(
    state: State<'_, DbState>,
    aid: String,
    cid: String,
    title: String,
    content: NovelContent,
) -> Result<(), String> {
    let json = serde_json::to_string(&content).map_err(|e| e.to_string())?;
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO novel_chapter_cache (aid, cid, title, content, cached_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![aid, cid, title, json, now_ms()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- 抓取命令 ----

#[tauri::command]
pub fn novel_search(
    node: String,
    charset: String,
    query: String,
    page: i64,
) -> Result<Vec<NovelCover>, String> {
    let q = if charset == "big5" {
        percent_encode_big5(&query)
    } else {
        percent_encode_gbk(&query)
    };
    let html = fetch_html(
        &app,
        &node,
        &charset,
        &format!("/modules/article/search.php?searchtype=articlename&searchkey={q}&page={page}"),
    )?;
    Ok(parse_list(&html, node_url(&node)))
}

#[tauri::command]
pub fn novel_rank(
    node: String,
    charset: String,
    sort: String,
    page: i64,
) -> Result<Vec<NovelCover>, String> {
    let html = fetch_html(
        &app,
        &node,
        &charset,
        &format!("/modules/article/toplist.php?sort={sort}&page={page}"),
    )?;
    Ok(parse_list(&html, node_url(&node)))
}

#[tauri::command]
pub fn novel_category(
    node: String,
    charset: String,
    tag: String,
    sort: String,
    page: i64,
) -> Result<Vec<NovelCover>, String> {
    let t = if charset == "big5" {
        percent_encode_big5(&tag)
    } else {
        percent_encode_gbk(&tag)
    };
    let html = fetch_html(
        &app,
        &node,
        &charset,
        &format!("/modules/article/tags.php?t={t}&v={sort}&page={page}"),
    )?;
    Ok(parse_list(&html, node_url(&node)))
}

#[tauri::command]
pub fn novel_recommend(app: tauri::AppHandle, node: String, charset: String) -> Result<Vec<NovelRecommendBlock>, String> {
    let html = fetch_html(&app, &node, &charset, "/index.php")?;
    Ok(parse_recommend(&html, node_url(&node)))
}

#[tauri::command]
pub fn novel_detail(
    app: tauri::AppHandle,
    node: String,
    charset: String,
    aid: String,
) -> Result<NovelDetail, String> {
    let html = fetch_html(
        &app,
        &node,
        &charset,
        &format!("/modules/article/articleinfo.php?id={aid}"),
    )?;
    if crate::novel_auth::is_login_required(&html) {
        return Err("[WENKU8_LOGIN_REQUIRED] 登录态已失效，请重新登录".into());
    }
    parse_detail(&html, &aid, node_url(&node))
}

#[tauri::command]
pub fn novel_catalogue(
    app: tauri::AppHandle,
    node: String,
    charset: String,
    aid: String,
) -> Result<Vec<NovelVolume>, String> {
    let html = fetch_html(
        &app,
        &node,
        &charset,
        &format!("/modules/article/reader.php?aid={aid}"),
    )?;
    if crate::novel_auth::is_login_required(&html) {
        return Err("[WENKU8_LOGIN_REQUIRED] 登录态已失效，请重新登录".into());
    }
    Ok(parse_catalogue(&html))
}

#[tauri::command]
pub fn novel_content(
    state: State<'_, DbState>,
    app: tauri::AppHandle,
    node: String,
    charset: String,
    aid: String,
    cid: String,
    title: String,
) -> Result<NovelContent, String> {
    // 先读缓存
    {
        let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
        let row = conn.query_row(
            "SELECT content FROM novel_chapter_cache WHERE aid = ?1 AND cid = ?2",
            rusqlite::params![aid, cid],
            |row| {
                let json: String = row.get(0)?;
                serde_json::from_str::<NovelContent>(&json)
                    .map_err(|_| rusqlite::Error::InvalidQuery)
            },
        );
        if let Ok(content) = row {
            return Ok(content);
        }
    }
    let html = fetch_html(
        &app,
        &node,
        &charset,
        &format!("/modules/article/reader.php?aid={aid}&cid={cid}"),
    )?;
    if crate::novel_auth::is_login_required(&html) {
        return Err("[WENKU8_LOGIN_REQUIRED] 登录态已失效，请重新登录".into());
    }
    let content = parse_content(&html, node_url(&node));
    // 写缓存（失败不影响阅读）
    {
        let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
        let json = serde_json::to_string(&content).map_err(|e| e.to_string())?;
        let _ = conn.execute(
            "INSERT OR REPLACE INTO novel_chapter_cache (aid, cid, title, content, cached_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![aid, cid, title, json, now_ms()],
        );
    }
    Ok(content)
}

// ---- 编码工具 ----

fn percent_encode_gbk(s: &str) -> String {
    let (bytes, _, _) = encoding_rs::GBK.encode(s);
    bytes
        .iter()
        .map(|b| format!("%{:02X}", b))
        .collect::<String>()
}

fn percent_encode_big5(s: &str) -> String {
    let (bytes, _, _) = encoding_rs::BIG5.encode(s);
    bytes
        .iter()
        .map(|b| format!("%{:02X}", b))
        .collect::<String>()
}

// ---- 阅读统计命令 ----

#[tauri::command]
pub fn novel_read_session_start(
    state: State<'_, DbState>,
    input: NovelReadSessionStart,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO novel_read_session (
            id, book_id, source, title, chapter_key, chapter_title,
            started_at, ended_at, duration_ms, completed
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, 0, 0)",
        rusqlite::params![
            input.id,
            input.book_id,
            input.source,
            input.title,
            input.chapter_key,
            input.chapter_title,
            input.started_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn novel_read_session_end(
    state: State<'_, DbState>,
    input: NovelReadSessionEnd,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let completed = if input.completed { 1 } else { 0 };
    conn.execute(
        "INSERT INTO novel_read_session (
            id, book_id, source, title, chapter_key, chapter_title,
            started_at, ended_at, duration_ms, completed
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           ended_at = excluded.ended_at,
           duration_ms = excluded.duration_ms,
           completed = excluded.completed,
           title = COALESCE(excluded.title, novel_read_session.title),
           chapter_title = COALESCE(excluded.chapter_title, novel_read_session.chapter_title)",
        rusqlite::params![
            input.id,
            input.book_id,
            input.source,
            input.title,
            input.chapter_key,
            input.chapter_title,
            input.started_at,
            input.ended_at,
            input.duration_ms,
            completed,
        ],
    )
    .map_err(|e| e.to_string())?;

    // 有效阅读：≥30s 或 completed
    if input.completed || input.duration_ms >= 30_000 {
        let day = epoch_ms_to_day(input.ended_at);
        let local_ms = if input.source == "local" { input.duration_ms } else { 0 };
        let online_ms = if input.source == "online" { input.duration_ms } else { 0 };
        conn.execute(
            "INSERT INTO novel_read_daily (day, read_count, total_ms, unique_books, local_ms, online_ms)
             VALUES (?1, 1, ?2, 0, ?3, ?4)
             ON CONFLICT(day) DO UPDATE SET
               read_count = read_count + 1,
               total_ms = total_ms + excluded.total_ms,
               local_ms = local_ms + excluded.local_ms,
               online_ms = online_ms + excluded.online_ms",
            rusqlite::params![day, input.duration_ms, local_ms, online_ms],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT OR IGNORE INTO novel_read_day_book (day, book_id) VALUES (?1, ?2)",
            rusqlite::params![day, input.book_id],
        )
        .map_err(|e| e.to_string())?;

        let unique: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM novel_read_day_book WHERE day = ?1",
                rusqlite::params![day],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE novel_read_daily SET unique_books = ?1 WHERE day = ?2",
            rusqlite::params![unique, day],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn novel_stats_get(
    state: State<'_, DbState>,
    day: Option<String>,
) -> Result<Option<NovelDailyStat>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let day = day.unwrap_or_else(today);
    let row = conn.query_row(
        "SELECT day, read_count, total_ms, unique_books, local_ms, online_ms FROM novel_read_daily WHERE day = ?1",
        rusqlite::params![day],
        |row| {
            Ok(NovelDailyStat {
                day: row.get(0)?,
                read_count: row.get(1)?,
                total_ms: row.get(2)?,
                unique_books: row.get(3)?,
                local_ms: row.get(4)?,
                online_ms: row.get(5)?,
            })
        },
    );
    match row {
        Ok(stats) => Ok(Some(stats)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn novel_stats_list(
    state: State<'_, DbState>,
    days: Option<i64>,
    from_day: Option<String>,
    to_day: Option<String>,
) -> Result<Vec<NovelDailyStat>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let from_str = match from_day {
        Some(f) if !f.is_empty() => f,
        _ => {
            let days = days.unwrap_or(7).clamp(1, 90);
            let naive = chrono::Local::now()
                .naive_local()
                .date()
                .checked_sub_signed(chrono::Duration::days(days - 1))
                .unwrap_or_default();
            naive.format("%Y-%m-%d").to_string()
        }
    };
    let to_str = match to_day {
        Some(t) if !t.is_empty() => t,
        _ => today(),
    };
    let mut stmt = conn
        .prepare(
            "SELECT day, read_count, total_ms, unique_books, local_ms, online_ms FROM novel_read_daily
             WHERE day >= ?1 AND day <= ?2 ORDER BY day DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![from_str, to_str], |row| {
            Ok(NovelDailyStat {
                day: row.get(0)?,
                read_count: row.get(1)?,
                total_ms: row.get(2)?,
                unique_books: row.get(3)?,
                local_ms: row.get(4)?,
                online_ms: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn novel_source_breakdown(
    state: State<'_, DbState>,
    days: Option<i64>,
    from_day: Option<String>,
    to_day: Option<String>,
) -> Result<Vec<NovelSourceStat>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let from_str = match from_day {
        Some(f) if !f.is_empty() => f,
        _ => {
            let days = days.unwrap_or(30).clamp(1, 365);
            let naive = chrono::Local::now()
                .naive_local()
                .date()
                .checked_sub_signed(chrono::Duration::days(days - 1))
                .unwrap_or_default();
            naive.format("%Y-%m-%d").to_string()
        }
    };
    let to_str = match to_day {
        Some(t) if !t.is_empty() => t,
        _ => today(),
    };
    let mut stmt = conn
        .prepare(
            "SELECT s.source, COUNT(*) AS read_count, COALESCE(SUM(s.duration_ms),0) AS total_ms
             FROM novel_read_session s
             WHERE s.ended_at IS NOT NULL AND (s.completed = 1 OR s.duration_ms >= 30000)
               AND substr(date(s.ended_at/1000,'unixepoch','localtime'),1,10) >= ?1
               AND substr(date(s.ended_at/1000,'unixepoch','localtime'),1,10) <= ?2
             GROUP BY s.source",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![from_str, to_str], |row| {
            Ok(NovelSourceStat {
                source: row.get(0)?,
                read_count: row.get(1)?,
                total_ms: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn novel_top_books(
    state: State<'_, DbState>,
    limit: Option<i64>,
    days: Option<i64>,
) -> Result<Vec<NovelTopBook>, String> {
    let limit = limit.unwrap_or(20).clamp(1, 100);
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let min_ended = match days {
        Some(d) if d > 0 => Some(now_ms() - d.clamp(1, 365) * 86_400_000),
        _ => None,
    };
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              s.book_id,
              s.source,
              COALESCE(NULLIF(MAX(s.title), ''), s.book_id) AS title,
              COALESCE(NULLIF(MAX(s.chapter_title), ''), '') AS chapter_title,
              COUNT(*) AS read_count,
              COALESCE(SUM(s.duration_ms),0) AS total_ms
            FROM novel_read_session s
            WHERE s.ended_at IS NOT NULL AND (s.completed = 1 OR s.duration_ms >= 30000)
              AND (?1 IS NULL OR s.ended_at >= ?1)
            GROUP BY s.book_id, s.source
            ORDER BY read_count DESC, total_ms DESC
            LIMIT ?2
            "#,
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![min_ended, limit], |row| {
            Ok(NovelTopBook {
                book_id: row.get(0)?,
                source: row.get(1)?,
                title: row.get(2)?,
                chapter_title: row.get(3)?,
                read_count: row.get(4)?,
                total_ms: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
