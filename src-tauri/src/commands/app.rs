//! 应用级命令：配合窗口关闭拦截 / 托盘菜单显式退出。
//!
//! 无边框窗口在 Windows 上直接走系统默认关闭路径不可靠
//! （参考项目经验：窗口可能关而不退），因此前端拦截
//! `onCloseRequested` 后调用这里显式退出进程。

#[tauri::command]
pub fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}