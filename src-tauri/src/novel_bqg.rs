//! 在线小说模块：笔趣阁（m.bqglll.cc）抓取。
//!
//! 与文库8（Wenku8）不同，笔趣阁是 JS 验证门 / 反爬站点：章节页与搜索结果
//! 服务端只返回「加载中……」壳，需真实浏览器执行 JS 过验证门后才能拿到正文。
//! 因此：
//! - 主页 / 详情页：服务端正常渲染 → Rust 直连 HTTP + scraper（UTF-8，无需 GBK 解码）。
//! - 搜索 / 目录 / 正文：走隐藏 WebView（复用 anime_webview_resolve 同款思路）
//!   加载页面、过验证门、注入脚本抽 DOM。
//!
//! 数据结构复用 `crate::novel` 的 Novel* 类型，前端无需新增类型。

use crate::novel::{NovelChapter, NovelContent, NovelCover, NovelDetail, NovelVolume};
use scraper::{Html, Selector};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::oneshot;

const BASE: &str = "https://m.bqglll.cc";
const UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0";

const BQG_WEBVIEW: &str = "bqg_resolve";
const BQG_TIMEOUT: Duration = Duration::from_secs(30);

// ----------------------------------------------------------------------------
// HTTP 工具（主页 / 详情直连，这两类服务端正常渲染）
// ----------------------------------------------------------------------------

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .no_proxy()
        .user_agent(UA)
        .build()
        .expect("bqg http client")
}

fn fetch(url: &str) -> Result<String, String> {
    let resp = client()
        .get(url)
        .send()
        .map_err(|e| format!("网络请求失败：{e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!(
            "笔趣阁返回 HTTP {}，可能被站点拦截，可稍后再试",
            status.as_u16()
        ));
    }
    resp.text().map_err(|e| format!("读取响应失败：{e}"))
}

fn regex_capture(hay: &str, pat: &str) -> Option<String> {
    let re = regex::Regex::new(pat).ok()?;
    re.captures(hay)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

// ----------------------------------------------------------------------------
// 解析：主页热书
// ----------------------------------------------------------------------------

fn parse_home(html: &str) -> Vec<NovelCover> {
    let doc = Html::parse_document(html);
    let item_sel = match Selector::parse(".hot .item") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let mut out = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for item in doc.select(&item_sel) {
        let a = item
            .select(&Selector::parse("a[href*=\"/look/\"]").unwrap())
            .next();
        let href = match a {
            Some(a) => a.value().attr("href").unwrap_or("").to_string(),
            None => continue,
        };
        let aid = match regex_capture(&href, r"/look/(\d+)/") {
            Some(a) => a,
            None => continue,
        };
        if !seen.insert(aid.clone()) {
            continue;
        }
        let image_url = item
            .select(&Selector::parse("img").unwrap())
            .next()
            .and_then(|e| e.value().attr("src"))
            .unwrap_or("")
            .to_string();
        let dt = item.select(&Selector::parse("dt").unwrap()).next();
        let (title, author) = if let Some(dt) = dt {
            let title = dt
                .select(&Selector::parse("a").unwrap())
                .next()
                .map(|a| a.text().collect::<Vec<_>>().join("").trim().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| dt.text().collect::<Vec<_>>().join("").trim().to_string());
            let author = dt
                .select(&Selector::parse("span").unwrap())
                .next()
                .map(|s| s.text().collect::<Vec<_>>().join("").trim().to_string())
                .unwrap_or_default();
            (title, author)
        } else {
            (String::new(), String::new())
        };
        if title.is_empty() {
            continue;
        }
        out.push(NovelCover {
            aid,
            title,
            image_url,
            author: if author.is_empty() {
                None
            } else {
                Some(author)
            },
        });
    }
    out
}

// ----------------------------------------------------------------------------
// 解析：详情
// ----------------------------------------------------------------------------

fn parse_detail(html: &str, aid: &str) -> NovelDetail {
    let doc = Html::parse_document(html);
    let title = doc
        .select(&Selector::parse("dt.name").unwrap())
        .next()
        .map(|e| e.text().collect::<Vec<_>>().join("").trim().to_string())
        .unwrap_or_default();
    let img_url = doc
        .select(&Selector::parse("div.cover img").unwrap())
        .next()
        .and_then(|e| e.value().attr("src"))
        .unwrap_or("")
        .to_string();

    let mut author = String::new();
    let mut status = String::new();
    let mut fin_update = String::new();
    let mut tags: Vec<String> = vec![];
    if let Ok(box_sel) = Selector::parse("dd.dd_box") {
        for dd in doc.select(&box_sel) {
            for span in dd.select(&Selector::parse("span").unwrap()) {
                let t = span.text().collect::<Vec<_>>().join("").trim().to_string();
                if let Some(v) = t.strip_prefix("作者：") {
                    author = v.to_string();
                } else if let Some(v) = t.strip_prefix("状态：") {
                    status = v.to_string();
                } else if let Some(v) = t.strip_prefix("更新：") {
                    fin_update = v.to_string();
                } else if let Some(v) = t.strip_prefix("分类：") {
                    tags.push(v.to_string());
                }
            }
        }
    }

    let introduce = doc
        .select(&Selector::parse("div.book_about dd").unwrap())
        .next()
        .map(|e| e.text().collect::<Vec<_>>().join("").trim().to_string())
        .unwrap_or_default();

    // 用 og:novel:latest_chapter_url 里的章节号推断总章节数（兜底目录用）
    let mut heat = String::new();
    if let Ok(meta_sel) = Selector::parse("meta[property=\"og:novel:latest_chapter_url\"]") {
        if let Some(m) = doc.select(&meta_sel).next() {
            if let Some(c) = m.value().attr("content") {
                if let Some(n) = regex_capture(c, r"/(\d+)\.html") {
                    heat = n;
                }
            }
        }
    }

    NovelDetail {
        aid: aid.to_string(),
        title,
        author,
        status,
        fin_update,
        img_url,
        introduce,
        tags,
        heat,
        trending: String::new(),
    }
}

// ----------------------------------------------------------------------------
// 隐藏 WebView 工具（搜索 / 目录 / 正文）
// ----------------------------------------------------------------------------

fn ensure_bqg_webview(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(BQG_WEBVIEW) {
        return Ok(w);
    }
    WebviewWindowBuilder::new(
        app,
        BQG_WEBVIEW,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .visible(false)
    .build()
    .map_err(|e| e.to_string())
}

/// 在 webview 里求值并把返回值（JSON 字符串）取回。
/// 回调是 `Fn` 非 `FnOnce`，故用 `Arc<Mutex<Option<Sender>>>` + take()。
async fn eval_json(webview: &WebviewWindow, script: &str) -> Option<String> {
    let (tx, rx) = oneshot::channel::<String>();
    let slot: Arc<Mutex<Option<oneshot::Sender<String>>>> = Arc::new(Mutex::new(Some(tx)));
    if webview
        .eval_with_callback(script, move |res: String| {
            let taken = slot.lock().ok().and_then(|mut g| g.take());
            if let Some(tx) = taken {
                let _ = tx.send(res);
            }
        })
        .is_err()
    {
        return None;
    }
    match tokio::time::timeout(Duration::from_secs(3), rx).await {
        Ok(Ok(s)) => Some(s),
        _ => None,
    }
}

/// 取数结束后停掉隐藏页并清空，避免后台继续加载。
fn stop_webview(webview: &WebviewWindow) {
    let _ = webview.eval("try{window.stop();}catch(e){}");
    let _ = webview.navigate(url::Url::parse("about:blank").unwrap());
}

const SEARCH_SCRIPT: &str = r#"(function(){
  try {
    var items = [];
    var nodes = document.querySelectorAll('.hot .item');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var a = n.querySelector('a[href*="/look/"]');
      if (!a) continue;
      var m = (a.getAttribute('href') || '').match(/\/look\/(\d+)\//);
      if (!m) continue;
      var img = n.querySelector('img');
      var dt = n.querySelector('dt');
      var title = dt
        ? (dt.querySelector('a') ? dt.querySelector('a').textContent.trim() : dt.textContent.trim())
        : (a.getAttribute('title') || a.textContent.trim());
      var span = dt ? dt.querySelector('span') : null;
      var author = span ? span.textContent.trim() : '';
      items.push({ aid: m[1], title: title, imageUrl: img ? (img.getAttribute('src') || '') : '', author: author });
    }
    return JSON.stringify(items);
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()"#;

const CATALOGUE_SCRIPT: &str = r#"(function(){
  try {
    var items = [];
    var links = document.querySelectorAll('a[href*="/look/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var m = (a.getAttribute('href') || '').match(/\/look\/\d+\/(\d+)\.html/);
      if (!m) continue;
      items.push({ cid: m[1], title: a.textContent.trim() });
    }
    var seen = {}, out = [];
    for (var j = 0; j < items.length; j++) {
      if (!seen[items[j].cid]) { seen[items[j].cid] = 1; out.push(items[j]); }
    }
    return JSON.stringify(out);
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()"#;

/// 正文抽取：优先常见内容容器，否则回退 body；剔除导航/广告/评论等噪声。
/// 注意：笔趣阁过验证门后的真实正文容器选择器需本机实测微调（见 README 备注）。
const CONTENT_SCRIPT: &str = r#"(function(){
  try {
    var sel = ['#content', '.content', '#chaptercontent', 'div[class*="content"]'];
    var el = null;
    for (var i = 0; i < sel.length && !el; i++) {
      el = document.querySelector(sel[i]);
    }
    if (!el) el = document.body;
    var clone = el.cloneNode(true);
    var noise = ['script','style','nav','header','footer','.comment','.search','.footer','.link','.book_last','.readlink','.book_about','.book_info','.clear','.header','.nav','.book_more'];
    for (var k = 0; k < noise.length; k++) {
      var bad = clone.querySelectorAll(noise[k]);
      for (var b = 0; b < bad.length; b++) {
        if (bad[b].parentNode) bad[b].parentNode.removeChild(bad[b]);
      }
    }
    var text = (clone.innerText || clone.textContent || '').replace(/\s+\n/g, '\n').trim();
    var h1 = document.querySelector('h1');
    var title = h1 ? h1.innerText.trim() : (document.title || '').trim();
    return JSON.stringify({ title: title, text: text });
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()"#;

const FALLBACK_SCRIPT: &str = r#"(function(){
  try {
    var ch = [];
    var links = document.querySelectorAll('.book_last a[href*="/look/"]');
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var m = (a.getAttribute('href') || '').match(/\/look\/\d+\/(\d+)\.html/);
      if (!m) continue;
      ch.push({ cid: m[1], title: a.textContent.trim() });
    }
    var total = 0;
    var meta = document.querySelector('meta[property="og:novel:latest_chapter_url"]');
    if (meta) {
      var mm = (meta.getAttribute('content') || '').match(/\/(\d+)\.html/);
      if (mm) total = parseInt(mm[1], 10);
    }
    return JSON.stringify({ chapters: ch, total: total });
  } catch (e) { return JSON.stringify({ error: String(e) }); }
})()"#;

// ----------------------------------------------------------------------------
// 命令：主页 / 详情（直连 HTTP）
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn bqg_home() -> Result<Vec<NovelCover>, String> {
    let html = tokio::task::spawn_blocking(|| fetch(&format!("{}/", BASE)))
        .await
        .map_err(|e| e.to_string())??;
    Ok(parse_home(&html))
}

#[tauri::command]
pub async fn bqg_detail(aid: String) -> Result<NovelDetail, String> {
    let url = format!("{}/look/{}/", BASE, aid);
    let html = tokio::task::spawn_blocking(move || fetch(&url))
        .await
        .map_err(|e| e.to_string())??;
    Ok(parse_detail(&html, &aid))
}

// ----------------------------------------------------------------------------
// 命令：搜索（WebView）
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn bqg_search(app: tauri::AppHandle, query: String) -> Result<Vec<NovelCover>, String> {
    let q = url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>();
    let url = format!("{}/s?q={}", BASE, q);
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let webview = ensure_bqg_webview(&app)?;
    webview
        .navigate(parsed)
        .map_err(|e| format!("导航搜索页失败：{e}"))?;

    let deadline = Instant::now() + BQG_TIMEOUT;
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(400)).await;
        if let Some(json) = eval_json(&webview, SEARCH_SCRIPT).await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                if let Some(arr) = v.as_array() {
                    let covers: Vec<NovelCover> = arr
                        .iter()
                        .filter_map(|x| {
                            let aid = x.get("aid")?.as_str()?.to_string();
                            let title = x.get("title")?.as_str()?.to_string();
                            let image_url = x
                                .get("imageUrl")
                                .and_then(|s| s.as_str())
                                .unwrap_or("")
                                .to_string();
                            let author = x
                                .get("author")
                                .and_then(|s| s.as_str())
                                .map(|s| s.to_string());
                            if title.is_empty() {
                                None
                            } else {
                                Some(NovelCover {
                                    aid,
                                    title,
                                    image_url,
                                    author,
                                })
                            }
                        })
                        .collect();
                    if !covers.is_empty() {
                        stop_webview(&webview);
                        return Ok(covers);
                    }
                }
            }
        }
    }
    stop_webview(&webview);
    Ok(vec![]) // 超时 / 被验证门拦截：返回空结果，前端显示无结果
}

// ----------------------------------------------------------------------------
// 命令：目录（WebView；失败回退到详情页最近章节 + 连续生成）
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn bqg_catalogue(app: tauri::AppHandle, aid: String) -> Result<Vec<NovelVolume>, String> {
    let url = format!("{}/look/{}/list.html", BASE, aid);
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let webview = ensure_bqg_webview(&app)?;
    webview
        .navigate(parsed)
        .map_err(|e| format!("导航目录页失败：{e}"))?;

    let deadline = Instant::now() + BQG_TIMEOUT;
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(400)).await;
        if let Some(json) = eval_json(&webview, CATALOGUE_SCRIPT).await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                if let Some(arr) = v.as_array() {
                    let chapters: Vec<NovelChapter> = arr
                        .iter()
                        .filter_map(|x| {
                            let cid = x.get("cid")?.as_str()?.to_string();
                            let title = x.get("title")?.as_str()?.to_string();
                            if title.is_empty() {
                                None
                            } else {
                                Some(NovelChapter { cid, title })
                            }
                        })
                        .collect();
                    if !chapters.is_empty() {
                        stop_webview(&webview);
                        return Ok(vec![NovelVolume {
                            title: "目录".to_string(),
                            chapters,
                        }]);
                    }
                }
            }
        }
    }
    stop_webview(&webview);
    Ok(build_fallback_catalogue(&app, &aid).await)
}

/// 兜底：目录页没拿到时，从详情页 `.book_last` 取最近章节标题，并据 og 元信息
/// 的总章节数连续生成 1..N（中间章节用「第 N 章」占位）。
async fn build_fallback_catalogue(app: &tauri::AppHandle, aid: &str) -> Vec<NovelVolume> {
    let url = format!("{}/look/{}/", BASE, aid);
    let parsed = match url::Url::parse(&url) {
        Ok(u) => u,
        Err(_) => return vec![],
    };
    let webview = match ensure_bqg_webview(app) {
        Ok(w) => w,
        Err(_) => return vec![],
    };
    let _ = webview.navigate(parsed);

    let deadline = Instant::now() + Duration::from_secs(20);
    let mut known: Vec<(String, String)> = vec![];
    let mut total: u32 = 0;
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(400)).await;
        if let Some(json) = eval_json(&webview, FALLBACK_SCRIPT).await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                if let Some(arr) = v.get("chapters").and_then(|c| c.as_array()) {
                    if !arr.is_empty() {
                        known = arr
                            .iter()
                            .filter_map(|x| {
                                let cid = x.get("cid")?.as_str()?.to_string();
                                let title = x.get("title")?.as_str()?.to_string();
                                Some((cid, title))
                            })
                            .collect();
                        total = v
                            .get("total")
                            .and_then(|t| t.as_u64())
                            .unwrap_or(0) as u32;
                        break;
                    }
                }
            }
        }
    }
    stop_webview(&webview);

    if known.is_empty() && total == 0 {
        return vec![];
    }
    let total = if total > 0 {
        total
    } else {
        known
            .first()
            .and_then(|(c, _)| c.parse::<u32>().ok())
            .unwrap_or(0)
    };
    if total == 0 {
        return vec![];
    }
    let known_map: HashMap<String, String> = known.into_iter().collect();
    let mut chapters = Vec::new();
    for i in 1..=total {
        let cid = i.to_string();
        let title = known_map
            .get(&cid)
            .cloned()
            .unwrap_or_else(|| format!("第{}章", i));
        chapters.push(NovelChapter { cid, title });
    }
    vec![NovelVolume {
        title: "目录".to_string(),
        chapters,
    }]
}

// ----------------------------------------------------------------------------
// 命令：正文（WebView）
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn bqg_content(
    app: tauri::AppHandle,
    aid: String,
    cid: String,
) -> Result<NovelContent, String> {
    let url = format!("{}/look/{}/{}.html", BASE, aid, cid);
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let webview = ensure_bqg_webview(&app)?;
    webview
        .navigate(parsed)
        .map_err(|e| format!("导航章节页失败：{e}"))?;

    let deadline = Instant::now() + BQG_TIMEOUT;
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(400)).await;
        if let Some(json) = eval_json(&webview, CONTENT_SCRIPT).await {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                if let Some(txt) = v.get("text").and_then(|x| x.as_str()) {
                    // 验证门未过时正文很短（壳页只有「加载中」），需等真实正文渲染
                    if txt.trim().len() > 50 {
                        let title = v
                            .get("title")
                            .and_then(|x| x.as_str())
                            .unwrap_or("")
                            .to_string();
                        stop_webview(&webview);
                        return Ok(NovelContent {
                            text: txt.trim().to_string(),
                            images: vec![],
                        });
                    }
                }
            }
        }
    }
    stop_webview(&webview);
    Err("笔趣阁正文加载超时（可能触发了站点验证或网络异常），可重试".into())
}
