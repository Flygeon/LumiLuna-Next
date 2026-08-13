//! 书籍阅读进度：读取 / 保存 `book_progress` 表。
//!
//! EPUB 用 CFI（location）定位精确位置；page 存章节/页码索引，percent 存百分比。
//! 每次翻页（relocated）保存，应用退出/关闭书籍时也会补一次。

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::commands::{now_secs, DbState};

/// 阅读进度（字段 camelCase，与前端 BookProgress 对应）
#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookProgress {
    pub book_id: String,
    pub location: String,
    pub page: i64,
    pub percent: f64,
    pub updated_at: i64,
}

/// 读取某本书的阅读进度；无记录时返回 null
#[tauri::command]
pub fn get_book_progress(
    app: tauri::AppHandle,
    file_id: String,
) -> Result<Option<BookProgress>, String> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = conn.query_row(
        "SELECT book_id, location, page, percent, updated_at
         FROM book_progress WHERE book_id=?1",
        rusqlite::params![file_id],
        |row| {
            Ok(BookProgress {
                book_id: row.get(0)?,
                location: row.get(1)?,
                page: row.get(2)?,
                percent: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    );
    match result {
        Ok(p) => Ok(Some(p)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// 保存 / 覆盖某本书的阅读进度
#[tauri::command]
pub fn save_book_progress(
    app: tauri::AppHandle,
    book_id: String,
    location: String,
    page: i64,
    percent: f64,
) -> Result<(), String> {
    let state = app.state::<DbState>();
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO book_progress (book_id, location, page, percent, updated_at)
         VALUES (?1,?2,?3,?4,?5)
         ON CONFLICT(book_id) DO UPDATE SET
           location=excluded.location, page=excluded.page,
           percent=excluded.percent, updated_at=excluded.updated_at",
        rusqlite::params![book_id, location, page, percent, now_secs()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
