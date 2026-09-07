//! 皮肤库存储命令：把导入的皮肤固化到 `{app_data_dir}/skins/<id>/`。
//! v1（纯 JSON）与 v2（ZIP 资产包）共用同一目录制存储——v2 目录里多一个 assets/ 子树。
//! 校验全部在前端 TS 侧完成（src/utils/skinSchema.ts），这里只做可信 IO；
//! id 到达本模块前虽已过正则校验，仍做防御性复检（id 同时是目录名，防路径穿越）。
//! ZIP 导入走两阶段事务：stage（解压到 .staging/）→ 前端校验 → commit（原子换入）/ abort。

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinMeta {
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: Option<String>,
    pub min_app_version: Option<String>,
    pub modes: Vec<String>,
    pub seed_color: bool,
    pub accent: Option<String>,
    /// 皮肤格式版本（1 = 纯 JSON，2 = ZIP 资产包），设置界面显示徽标用
    pub format_version: u32,
    /// v2 能力徽标：是否携带背景图 / 图标包
    pub has_background: bool,
    pub has_icons: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinEntry {
    /// 目录名（库内唯一键；manifest.id 在导入时与之强制一致）
    pub id: String,
    /// "ok" | "broken"
    pub status: String,
    pub error: Option<String>,
    pub meta: Option<SkinMeta>,
}

/// skin_load 的返回：json 原文 + 库内文件清单（v2 资产引用存在性校验与图标清单用）
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSkin {
    pub json: Option<String>,
    pub files: Vec<String>,
}

/// skin_stage_zip 的返回：staging 令牌 + skin.json 原文 + 解包文件清单
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedSkin {
    pub staging: String,
    pub json: String,
    pub files: Vec<String>,
}

// ---- v2 ZIP 防护参数（方案书 v2 §3.3）----
const ZIP_MAX_ENTRIES: usize = 200;
const ZIP_MAX_TOTAL: u64 = 50 * 1024 * 1024;
const ZIP_MAX_FILE: u64 = 10 * 1024 * 1024;
const ZIP_MAX_FONT: u64 = 5 * 1024 * 1024;
const SKIN_JSON_LIMIT: u64 = 256 * 1024;

fn skins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("skins"))
}

/// id 防御性校验：仅 [a-z0-9-.]，长度 2–64，禁首尾点与连续点（杜绝 `..` 穿越）。
/// 与前端 skinSchema.ts 的 ID_RE 语义一致。
fn valid_id(id: &str) -> bool {
    if id.len() < 2 || id.len() > 64 || !id.is_ascii() {
        return false;
    }
    let mut prev_dot = true; // 首字符不允许 '.'
    for ch in id.chars() {
        if ch == '.' {
            if prev_dot {
                return false;
            }
            prev_dot = true;
        } else if ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-' {
            prev_dot = false;
        } else {
            return false;
        }
    }
    !prev_dot // 结尾不允许 '.'
}

/// Windows 保留设备名（con / prn / aux / nul / com1-9 / lpt1-9）不能当目录名
fn reserved_name(id: &str) -> bool {
    let first = id.split('.').next().unwrap_or("");
    const RESERVED: &[&str] = &["con", "prn", "aux", "nul"];
    if RESERVED.contains(&first) {
        return true;
    }
    if let Some(num) = first
        .strip_prefix("com")
        .or_else(|| first.strip_prefix("lpt"))
    {
        if let Ok(k) = num.parse::<u32>() {
            if (1..=9).contains(&k) {
                return true;
            }
        }
    }
    false
}

/// staging 令牌校验：形如 <毫秒时间戳>-<进程id>，防止把任意路径当 staging 用
fn valid_staging(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 32
        && token.chars().all(|c| c.is_ascii_digit() || c == '-')
        && token.matches('-').count() == 1
}

fn staging_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(skins_dir(app)?.join(".staging"))
}

/// 清扫遗留 staging（stage 前执行，兼顾「启动清扫」——首次 stage 必然先经过这里）
fn clean_staging(root: &Path) {
    if let Ok(entries) = std::fs::read_dir(root) {
        for e in entries.flatten() {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// 递归列出目录下全部文件的相对路径（正斜杠分隔），供资产清单使用
fn list_files_recursively(base: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(base) else {
        return out;
    };
    for e in entries.flatten() {
        let p = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue; // 隐藏目录（.staging 等）不属于任何皮肤的资产
        }
        if p.is_dir() {
            for sub in list_files_recursively(&p) {
                out.push(format!("{name}/{sub}"));
            }
        } else if name != "skin.json" {
            out.push(name);
        }
    }
    out
}

fn parse_meta(v: &serde_json::Value) -> Result<SkinMeta, String> {
    let m = v
        .get("manifest")
        .and_then(|x| x.as_object())
        .ok_or("缺少 manifest")?;
    let name = m
        .get("name")
        .and_then(|x| x.as_str())
        .ok_or("缺少 manifest.name")?
        .to_string();
    let version = m
        .get("version")
        .and_then(|x| x.as_str())
        .ok_or("缺少 manifest.version")?
        .to_string();
    let author = m
        .get("author")
        .and_then(|x| x.as_str())
        .ok_or("缺少 manifest.author")?
        .to_string();
    let modes = m
        .get("modes")
        .and_then(|x| x.as_array())
        .ok_or("缺少 manifest.modes")?
        .iter()
        .filter_map(|x| x.as_str().map(String::from))
        .collect();
    Ok(SkinMeta {
        name,
        version,
        author,
        description: m
            .get("description")
            .and_then(|x| x.as_str())
            .map(String::from),
        min_app_version: m
            .get("minAppVersion")
            .and_then(|x| x.as_str())
            .map(String::from),
        modes,
        seed_color: m
            .get("seedColor")
            .and_then(|x| x.as_bool())
            .unwrap_or(false),
        accent: m.get("accent").and_then(|x| x.as_str()).map(String::from),
        format_version: v.get("formatVersion").and_then(|x| x.as_u64()).unwrap_or(1) as u32,
        has_background: v.get("background").map(|x| !x.is_null()).unwrap_or(false),
        has_icons: v.get("icons").map(|x| !x.is_null()).unwrap_or(false),
    })
}

/// 读取用户经对话框/拖拽选中的外部皮肤文件原文（v1 JSON）
#[tauri::command]
pub fn skin_read_external_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("无法读取文件：{e}"))
}

/// v2 ZIP 导入第一阶段：解压到 skins/.staging/<token>/ 并做全部防护检查，
/// 返回 skin.json 原文与文件清单供前端校验。校验失败由 skin_abort 丢弃。
#[tauri::command]
pub fn skin_stage_zip(app: tauri::AppHandle, path: String) -> Result<StagedSkin, String> {
    let root = staging_root(&app)?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    clean_staging(&root);

    let token = format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        std::process::id()
    );
    let dest_dir = root.join(&token);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let file = std::fs::File::open(&path).map_err(|e| format!("无法打开文件：{e}"))?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file))
        .map_err(|e| format!("损坏的 ZIP 包：{e}"))?;

    if archive.len() > ZIP_MAX_ENTRIES {
        return Err(format!("ZIP 条目数超过上限（{ZIP_MAX_ENTRIES}）"));
    }

    let mut total: u64 = 0;
    let mut files: Vec<String> = Vec::new();
    let mut skin_json: Option<String> = None;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读取 ZIP 条目失败：{e}"))?;
        // 规范化路径分隔符（Windows 打包工具常写反斜杠），再做穿越检查
        let name = entry.name().replace('\\', "/");
        if name.is_empty() {
            continue;
        }
        // 跳过 macOS 元数据与隐藏文件
        let first = name.split('/').next().unwrap_or("");
        if first == "__MACOSX" || first.starts_with('.') {
            continue;
        }
        if name.starts_with('/') || name.contains("..") || name.contains(':') || name.contains('\0')
        {
            return Err(format!("ZIP 内含不安全路径：{}", entry.name()));
        }
        let is_font = name.to_ascii_lowercase().ends_with(".woff2")
            || name.to_ascii_lowercase().ends_with(".woff")
            || name.to_ascii_lowercase().ends_with(".ttf");
        let cap = if is_font { ZIP_MAX_FONT } else { ZIP_MAX_FILE };
        if entry.is_dir() {
            std::fs::create_dir_all(dest_dir.join(&name)).map_err(|e| e.to_string())?;
            continue;
        }
        // 实际读取（不信任 zip 头声明的 size，累计真实解压量防炸弹）
        let mut buf: Vec<u8> = Vec::new();
        entry
            .read_to_end(&mut buf)
            .map_err(|e| format!("解压失败：{e}"))?;
        if buf.len() as u64 > cap {
            return Err(format!("文件超过大小上限（{} KB）：{name}", cap / 1024));
        }
        total += buf.len() as u64;
        if total > ZIP_MAX_TOTAL {
            return Err(format!(
                "解压总量超过上限（{} MB）",
                ZIP_MAX_TOTAL / 1024 / 1024
            ));
        }
        if name == "skin.json" {
            if buf.len() as u64 > SKIN_JSON_LIMIT {
                return Err("skin.json 超过大小上限（256 KB）".into());
            }
            skin_json =
                Some(String::from_utf8(buf).map_err(|_| "skin.json 不是 UTF-8 文本".to_string())?);
            continue;
        }
        let dest = dest_dir.join(&name);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&dest, &buf).map_err(|e| e.to_string())?;
        files.push(name);
    }

    match skin_json {
        Some(json) => Ok(StagedSkin {
            staging: token,
            json,
            files,
        }),
        None => Err("ZIP 包根目录缺少 skin.json".into()),
    }
}

/// v2 ZIP 导入第二阶段：校验通过后原子换入 skins/<id>/。
/// 覆盖更新有回滚：旧目录先改名 .trash-*，新目录换入失败则改回。
#[tauri::command]
pub fn skin_commit(app: tauri::AppHandle, staging: String, id: String) -> Result<(), String> {
    if !valid_staging(&staging) {
        return Err(format!("非法 staging 令牌：{staging}"));
    }
    if !valid_id(&id) || reserved_name(&id) {
        return Err(format!("非法皮肤 id：{id}"));
    }
    let src = staging_root(&app)?.join(&staging);
    if !src.is_dir() {
        return Err("staging 目录不存在（可能已被清扫）".into());
    }
    // 换入的内容必须仍是合法皮肤（skin.json 在位）
    if !src.join("skin.json").is_file() {
        return Err("staging 内缺少 skin.json".into());
    }
    let dir = skins_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&id);
    let mut trash: Option<PathBuf> = None;
    if dest.exists() {
        let t = dir.join(format!(
            ".trash-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            id
        ));
        std::fs::rename(&dest, &t).map_err(|e| e.to_string())?;
        trash = Some(t);
    }
    if let Err(e) = std::fs::rename(&src, &dest) {
        // 回滚：把旧目录改回原名
        if let Some(t) = &trash {
            let _ = std::fs::rename(t, &dest);
        }
        return Err(format!("皮肤换入失败：{e}"));
    }
    if let Some(t) = trash {
        let _ = std::fs::remove_dir_all(t);
    }
    // 顺带清理可能残留的 .trash-*
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            if e.file_name().to_string_lossy().starts_with(".trash-") {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
    Ok(())
}

/// v2 ZIP 导入放弃：丢弃 staging
#[tauri::command]
pub fn skin_abort(app: tauri::AppHandle, staging: String) -> Result<(), String> {
    if !valid_staging(&staging) {
        return Err(format!("非法 staging 令牌：{staging}"));
    }
    let src = staging_root(&app)?.join(&staging);
    if src.is_dir() {
        std::fs::remove_dir_all(src).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// v1 JSON 固化保存（同 id 覆盖 = 更新）。json 为前端校验后的规范化文档原文。
#[tauri::command]
pub fn skin_save(app: tauri::AppHandle, id: String, json: String) -> Result<(), String> {
    if !valid_id(&id) || reserved_name(&id) {
        return Err(format!("非法皮肤 id：{id}"));
    }
    let dir = skins_dir(&app)?;
    let skin_dir = dir.join(&id);
    std::fs::create_dir_all(&skin_dir).map_err(|e| e.to_string())?;
    // 先写临时文件再改名，尽量原子地完成覆盖更新
    let dest = skin_dir.join("skin.json");
    let tmp = skin_dir.join("skin.json.tmp");
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    if dest.exists() {
        let _ = std::fs::remove_file(&dest);
    }
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// 扫描皮肤库目录：目录即注册表（v1 方案书 §5），损坏条目带原因返回而不中断。
/// 隐藏目录（.staging / .trash-*）不是皮肤。
#[tauri::command]
pub fn skin_list(app: tauri::AppHandle) -> Result<Vec<SkinEntry>, String> {
    let dir = skins_dir(&app)?;
    let mut out = Vec::new();
    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(_) => return Ok(out), // 目录尚不存在 = 空库
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        // 目录名是库内唯一键；manifest.id 若被外部改动导致不一致，按目录名处理
        let id = entry.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') {
            continue;
        }
        let raw = match std::fs::read_to_string(entry.path().join("skin.json")) {
            Ok(r) => r,
            Err(e) => {
                out.push(SkinEntry {
                    id,
                    status: "broken".into(),
                    error: Some(format!("无法读取 skin.json：{e}")),
                    meta: None,
                });
                continue;
            }
        };
        let parsed = serde_json::from_str::<serde_json::Value>(&raw)
            .map_err(|e| format!("JSON 解析失败：{e}"))
            .and_then(|v| parse_meta(&v));
        match parsed {
            Ok(meta) => out.push(SkinEntry {
                id,
                status: "ok".into(),
                error: None,
                meta: Some(meta),
            }),
            Err(e) => out.push(SkinEntry {
                id,
                status: "broken".into(),
                error: Some(e),
                meta: None,
            }),
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// 按需读取单个皮肤：json 原文 + 库内资产文件清单（v1 皮肤清单为空）
#[tauri::command]
pub fn skin_load(app: tauri::AppHandle, id: String) -> Result<LoadedSkin, String> {
    if !valid_id(&id) {
        return Err(format!("非法皮肤 id：{id}"));
    }
    let dir = skins_dir(&app)?.join(&id);
    let json = std::fs::read_to_string(dir.join("skin.json")).ok();
    let files = if dir.is_dir() {
        list_files_recursively(&dir)
    } else {
        Vec::new()
    };
    Ok(LoadedSkin { json, files })
}

/// 删除皮肤目录（删除激活中的皮肤前，前端会先切回默认）
#[tauri::command]
pub fn skin_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err(format!("非法皮肤 id：{id}"));
    }
    let dir = skins_dir(&app)?.join(&id);
    if dir.exists() {
        std::fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// skins 目录绝对路径：前端用 convertFileSrc 把包内相对路径拼成 asset:// URL
#[tauri::command]
pub fn skin_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(skins_dir(&app)?.to_string_lossy().into_owned())
}
