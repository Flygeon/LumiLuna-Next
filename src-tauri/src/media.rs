//! 扩展名 → 媒体种类的单一事实来源。
//! 扫描、元数据解析、缩略图三处共用，避免各自维护一份白名单导致分类漂移。

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum MediaKind {
    Image,
    Video,
    Audio,
    Book,
}

impl MediaKind {
    pub fn as_str(self) -> &'static str {
        match self {
            MediaKind::Image => "image",
            MediaKind::Video => "video",
            MediaKind::Audio => "audio",
            MediaKind::Book => "book",
        }
    }
}

pub const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "png", "gif", "webp", "bmp", "tif", "tiff", "avif", "heic", "heif",
    "jfif", "ico", "svg",
];
pub const VIDEO_EXTS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "flv", "wmv", "mpg", "mpeg", "ts", "m2ts", "3gp",
    "ogv",
];
pub const AUDIO_EXTS: &[&str] = &[
    "mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wma", "aiff", "aif", "ape", "alac",
    "mpc", "wv",
];
pub const BOOK_EXTS: &[&str] = &["epub", "pdf", "mobi", "azw3", "fb2", "cbz", "cbr", "txt"];

/// image crate 能直接解码的位图格式（用于缩略图快路径）。
pub const DECODABLE_IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "jpe", "png", "gif", "webp", "bmp", "tif", "tiff", "jfif", "ico",
];

/// 按扩展名归类；未知扩展返回 None，扫描时直接跳过。
pub fn classify(ext: &str) -> Option<MediaKind> {
    let e = ext.to_ascii_lowercase();
    let e = e.as_str();
    if IMAGE_EXTS.contains(&e) {
        Some(MediaKind::Image)
    } else if VIDEO_EXTS.contains(&e) {
        Some(MediaKind::Video)
    } else if AUDIO_EXTS.contains(&e) {
        Some(MediaKind::Audio)
    } else if BOOK_EXTS.contains(&e) {
        Some(MediaKind::Book)
    } else {
        None
    }
}

/// 从路径取小写扩展名（不含点）。
pub fn ext_of(path: &std::path::Path) -> String {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}
