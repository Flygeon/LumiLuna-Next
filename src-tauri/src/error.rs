//! 统一错误类型。
//!
//! 使用 `thiserror` 定义强类型错误枚举 `LumiLunaError`，覆盖应用内常见错误来源；
//! 内部辅助函数可使用 `anyhow::Result` 便捷传播错误，在命令边界再映射为
//! `LumiLunaError` 或 `String` 返回给前端。
//!
//! 逐步迁移指南：
//! - 新增模块优先使用 `LumiLunaResult<T>` 作为返回类型；
//! - 内部可链式调用的函数可用 `anyhow::Result<T>`；
//! - 历史 `Result<T, String>` 函数可保持不变，按需迁移。

use thiserror::Error;

/// 应用统一错误类型。
#[derive(Error, Debug)]
pub enum LumiLunaError {
    /// I/O 错误（文件读写、目录创建等）
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    /// 数据库错误（rusqlite）
    #[error("database error: {0}")]
    Rusqlite(#[from] rusqlite::Error),

    /// JSON 序列化 / 反序列化错误
    #[error("JSON error: {0}")]
    SerdeJson(#[from] serde_json::Error),

    /// 路径解析错误
    #[error("path error: {0}")]
    Path(String),

    /// 通用业务错误（兼容历史 String 错误）
    #[error("{0}")]
    Other(String),
}

impl From<String> for LumiLunaError {
    fn from(s: String) -> Self {
        LumiLunaError::Other(s)
    }
}

impl From<&str> for LumiLunaError {
    fn from(s: &str) -> Self {
        LumiLunaError::Other(s.to_string())
    }
}

/// 应用级 Result 别名。
pub type Result<T> = std::result::Result<T, LumiLunaError>;
