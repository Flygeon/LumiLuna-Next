use chrono::{Local, NaiveDate};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

use crate::commands::{now_ms, DbState};

// ── 请求 / 响应结构体 ──────────────────────────────────────────

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaySessionStart {
    pub id: String,
    pub track_id: String,
    pub source: String,
    pub started_at: i64,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub content_hash: Option<String>,
    pub cover_url: Option<String>,
    pub src_url: Option<String>,
    pub quality_br: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaySessionEnd {
    pub id: String,
    pub track_id: String,
    pub source: String,
    pub started_at: i64,
    pub ended_at: i64,
    pub listened_ms: i64,
    pub completed: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub content_hash: Option<String>,
    pub cover_url: Option<String>,
    pub src_url: Option<String>,
    pub quality_br: Option<i64>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenStats {
    pub day: String,
    pub play_count: i64,
    pub unique_tracks: i64,
    pub total_ms: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenSourceStat {
    pub source: String,
    pub play_count: i64,
    pub total_ms: i64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopTrackStat {
    pub track_id: String,
    pub source: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover_url: Option<String>,
    pub file_path: Option<String>,
    pub file_name: Option<String>,
    pub content_hash: Option<String>,
    pub play_count: i64,
    pub total_ms: i64,
    pub src_url: Option<String>,
}

// ── 日期工具 ──────────────────────────────────────────────────

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn epoch_ms_to_day(ms: i64) -> String {
    let secs = ms / 1000;
    let days = secs / 86_400;
    // 从 Unix 纪元秒转本地日期
    let naive = NaiveDate::from_ymd_opt(1970, 1, 1)
        .unwrap()
        .checked_add_signed(chrono::Duration::days(days as i64))
        .unwrap_or_default();
    naive.format("%Y-%m-%d").to_string()
}

fn parse_ymd_to_epoch_ms(day: &str) -> Option<i64> {
    let naive = NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
    let days = naive
        .signed_duration_since(NaiveDate::from_ymd_opt(1970, 1, 1).unwrap())
        .num_days();
    Some(days * 86_400_000)
}

// ── 命令 ──────────────────────────────────────────────────────

#[tauri::command]
pub fn start_play_session(
    state: State<'_, DbState>,
    input: PlaySessionStart,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO play_session (
            id, track_id, source, started_at, ended_at, listened_ms, completed, quality_br,
            title, artist, album, file_path, file_name, content_hash, cover_url, src_url
         )
         VALUES (?1, ?2, ?3, ?4, NULL, 0, 0, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            input.id,
            input.track_id,
            input.source,
            input.started_at,
            input.quality_br,
            input.title,
            input.artist,
            input.album,
            input.file_path,
            input.file_name,
            input.content_hash,
            input.cover_url,
            input.src_url,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn end_play_session(
    state: State<'_, DbState>,
    input: PlaySessionEnd,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let completed = if input.completed { 1 } else { 0 };

    conn.execute(
        "INSERT INTO play_session (
            id, track_id, source, started_at, ended_at, listened_ms, completed, quality_br,
            title, artist, album, file_path, file_name, content_hash, cover_url, src_url
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
         ON CONFLICT(id) DO UPDATE SET
           ended_at = excluded.ended_at,
           listened_ms = excluded.listened_ms,
           completed = excluded.completed,
           quality_br = COALESCE(excluded.quality_br, play_session.quality_br),
           title = COALESCE(excluded.title, play_session.title),
           artist = COALESCE(excluded.artist, play_session.artist),
           album = COALESCE(excluded.album, play_session.album),
           file_path = COALESCE(excluded.file_path, play_session.file_path),
           file_name = COALESCE(excluded.file_name, play_session.file_name),
           content_hash = COALESCE(excluded.content_hash, play_session.content_hash),
           cover_url = COALESCE(excluded.cover_url, play_session.cover_url),
           src_url = COALESCE(excluded.src_url, play_session.src_url)",
        params![
            input.id,
            input.track_id,
            input.source,
            input.started_at,
            input.ended_at,
            input.listened_ms,
            completed,
            input.quality_br,
            input.title,
            input.artist,
            input.album,
            input.file_path,
            input.file_name,
            input.content_hash,
            input.cover_url,
            input.src_url,
        ],
    )
    .map_err(|e| e.to_string())?;

    // 有效听歌：≥30s 或 completed
    let counts = input.completed || input.listened_ms >= 30_000;
    if counts {
        let day = epoch_ms_to_day(input.ended_at);
        conn.execute(
            "INSERT INTO listen_daily (day, play_count, unique_tracks, total_ms)
             VALUES (?1, 1, 0, ?2)
             ON CONFLICT(day) DO UPDATE SET
               play_count = play_count + 1,
               total_ms = total_ms + excluded.total_ms",
            params![day, input.listened_ms],
        )
        .map_err(|e| e.to_string())?;

        // 日去重
        conn.execute(
            "INSERT OR IGNORE INTO listen_day_track (day, track_id) VALUES (?1, ?2)",
            params![day, input.track_id],
        )
        .map_err(|e| e.to_string())?;

        let unique: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM listen_day_track WHERE day = ?1",
                params![day],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE listen_daily SET unique_tracks = ?1 WHERE day = ?2",
            params![unique, day],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn get_listen_stats(
    state: State<'_, DbState>,
    day: Option<String>,
) -> Result<Option<ListenStats>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;
    let day = day.unwrap_or_else(today);
    let row = conn.query_row(
        "SELECT day, play_count, unique_tracks, total_ms FROM listen_daily WHERE day = ?1",
        params![day],
        |row| {
            Ok(ListenStats {
                day: row.get(0)?,
                play_count: row.get(1)?,
                unique_tracks: row.get(2)?,
                total_ms: row.get(3)?,
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
pub fn list_listen_stats(
    state: State<'_, DbState>,
    days: Option<i64>,
    from_day: Option<String>,
    to_day: Option<String>,
) -> Result<Vec<ListenStats>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;

    let from_str = match from_day {
        Some(f) if !f.is_empty() => f,
        _ => {
            let days = days.unwrap_or(7).clamp(1, 90);
            let naive = Local::now().naive_local().date()
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
            "SELECT day, play_count, unique_tracks, total_ms FROM listen_daily
             WHERE day >= ?1 AND day <= ?2 ORDER BY day DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from_str, to_str], |row| {
            Ok(ListenStats {
                day: row.get(0)?,
                play_count: row.get(1)?,
                unique_tracks: row.get(2)?,
                total_ms: row.get(3)?,
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
pub fn list_top_tracks(
    state: State<'_, DbState>,
    limit: Option<i64>,
    days: Option<i64>,
    from_day: Option<String>,
    to_day: Option<String>,
) -> Result<Vec<TopTrackStat>, String> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;

    let min_ended: Option<i64> = match from_day {
        Some(f) if !f.is_empty() => parse_ymd_to_epoch_ms(&f),
        _ => match days {
            Some(d) if d > 0 => {
                let d = d.clamp(1, 365);
                Some(now_ms() - d * 86_400_000)
            }
            _ => None,
        },
    };
    let max_ended: Option<i64> = match to_day {
        Some(t) if !t.is_empty() => parse_ymd_to_epoch_ms(&t).map(|v| v + 86_400_000 - 1),
        _ => None,
    };

    let sql = r#"
        SELECT
          s.track_id,
          s.source,
          COALESCE(NULLIF(MAX(s.title), ''), s.track_id) AS title,
          COALESCE(NULLIF(MAX(s.artist), ''), '') AS artist,
          COALESCE(NULLIF(MAX(s.album), ''), '') AS album,
          MAX(s.cover_url) AS cover_url,
          MAX(s.file_path) AS file_path,
          MAX(s.file_name) AS file_name,
          MAX(s.content_hash) AS content_hash,
          COUNT(*) AS play_count,
          COALESCE(SUM(s.listened_ms), 0) AS total_ms,
          MAX(s.src_url) AS src_url
        FROM play_session s
        WHERE s.ended_at IS NOT NULL
          AND (s.completed = 1 OR s.listened_ms >= 30000)
          AND (?1 IS NULL OR s.ended_at >= ?1)
          AND (?3 IS NULL OR s.ended_at <= ?3)
        GROUP BY s.track_id, s.source
        ORDER BY play_count DESC, total_ms DESC
        LIMIT ?2
    "#;

    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![min_ended, limit, max_ended], |row| {
            Ok(TopTrackStat {
                track_id: row.get(0)?,
                source: row.get(1)?,
                title: row.get(2)?,
                artist: row.get(3)?,
                album: row.get(4)?,
                cover_url: row.get(5)?,
                file_path: row.get(6)?,
                file_name: row.get(7)?,
                content_hash: row.get(8)?,
                play_count: row.get(9)?,
                total_ms: row.get(10)?,
                src_url: row.get(11)?,
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
pub fn listen_source_breakdown(
    state: State<'_, DbState>,
    days: Option<i64>,
    from_day: Option<String>,
    to_day: Option<String>,
) -> Result<Vec<ListenSourceStat>, String> {
    let conn = state.0.lock().map_err(|_| "db lock".to_string())?;

    let min_ended: Option<i64> = match from_day {
        Some(f) if !f.is_empty() => parse_ymd_to_epoch_ms(&f),
        _ => match days {
            Some(d) if d > 0 => {
                let d = d.clamp(1, 365);
                Some(now_ms() - d * 86_400_000)
            }
            _ => None,
        },
    };
    let max_ended: Option<i64> = match to_day {
        Some(t) if !t.is_empty() => parse_ymd_to_epoch_ms(&t).map(|v| v + 86_400_000 - 1),
        _ => None,
    };

    let mut stmt = conn
        .prepare(
            r#"
            SELECT
              s.source,
              COUNT(*) AS play_count,
              COALESCE(SUM(s.listened_ms), 0) AS total_ms
            FROM play_session s
            WHERE s.ended_at IS NOT NULL
              AND (s.completed = 1 OR s.listened_ms >= 30000)
              AND (?1 IS NULL OR s.ended_at >= ?1)
              AND (?2 IS NULL OR s.ended_at <= ?2)
            GROUP BY s.source
            ORDER BY play_count DESC
            "#,
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![min_ended, max_ended], |row| {
            Ok(ListenSourceStat {
                source: row.get(0)?,
                play_count: row.get(1)?,
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