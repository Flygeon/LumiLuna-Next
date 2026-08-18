//! 系统托盘：左键点击显示主界面，右键菜单控制播放、显示主界面、退出。
//!
//! 播放器动作通过 `app:player-command` 事件回传前端（字符串 action：
//! toggle / next / prev），由 `useDesktopChrome` 统一分发到 player store，
//! 与 SMTC 媒体键的命令分发共享同一套前端动作。

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

fn show_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

fn emit_command(app: &AppHandle, action: &str) {
    let _ = app.emit("app:player-command", action);
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "播放 / 暂停", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&toggle, &next, &prev, &separator, &show, &quit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("icon".into()))?;

    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip("LumiLuna")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "toggle" => emit_command(app, "toggle"),
            "next" => emit_command(app, "next"),
            "prev" => emit_command(app, "prev"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    tray.set_visible(true)?;
    Ok(())
}