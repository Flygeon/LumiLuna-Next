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