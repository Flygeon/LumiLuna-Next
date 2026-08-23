//! 皮肤库存储命令：把导入的皮肤固化到 `{app_data_dir}/skins/<id>/skin.json`。
//! 校验全部在前端 TS 侧完成（src/utils/skinSchema.ts），这里只做可信 IO；
//! id 到达本模块前虽已过正则校验，仍做防御性复检（id 同时是目录名，防路径穿越）。

use serde::Serialize;
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

fn skins_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
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
        accent: m
            .get("accent")
            .and_then(|x| x.as_str())
            .map(String::from),
    })
}

/// 读取用户经对话框/拖拽选中的外部皮肤文件原文
#[tauri::command]
pub fn skin_read_external_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("无法读取文件：{e}"))
}

/// 固化保存皮肤（同 id 覆盖 = 更新）。json 为前端校验后的规范化文档原文。
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

/// 扫描皮肤库目录：目录即注册表（方案书 §5），损坏条目带原因返回而不中断
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

/// 按需读取单个皮肤全文；不存在返回 None（由前端回退默认皮肤）
#[tauri::command]
pub fn skin_load(app: tauri::AppHandle, id: String) -> Result<Option<String>, String> {
    if !valid_id(&id) {
        return Err(format!("非法皮肤 id：{id}"));
    }
    let path = skins_dir(&app)?.join(&id).join("skin.json");
    match std::fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(_) => Ok(None),
    }
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
