//! 应用级命令：配合窗口关闭拦截 / 托盘菜单显式退出、开发者工具。

use tauri::Manager;

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn open_devtools(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
        Ok(())
    } else {
        Err("No main window found".into())
    }
}

/// 皮肤逃生通道（方案书 §6.5）：以 --safe-mode 启动时前端跳过一切皮肤加载，
/// 让被坏皮肤盖住的界面也能回到默认主题操作设置。
#[tauri::command]
pub fn is_safe_mode() -> bool {
    std::env::args().any(|a| a.trim().eq_ignore_ascii_case("--safe-mode"))
}