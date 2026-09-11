//! 系统托盘：左键点击显示主界面，右键菜单控制播放、显示主界面、退出。
//!
//! 播放器动作通过 `app:player-command` 事件回传前端（字符串 action：
//! toggle / next / prev），由 `useDesktopChrome` 统一分发到 player store，
//! 与 SMTC 媒体键的命令分发共享同一套前端动作。
//!
//! 「扩展」子菜单列出各已安装扩展在 manifest 中声明的托盘贡献项，
//! 菜单 id 形如 `ext:<ext_id>:<item_id>`，由扩展框架处理。

use tauri::menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};

use crate::commands::extension;

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

    // 扩展子菜单：收集各扩展声明的托盘贡献项
    let ext_items = extension::tray_menu_items(app);
    let sub = if !ext_items.is_empty() {
        let mut owned: Vec<MenuItem> = Vec::new();
        for (id, title) in &ext_items {
            owned.push(MenuItem::with_id(
                app,
                id.clone(),
                title.clone(),
                true,
                None::<&str>,
            )?);
        }
        let refs: Vec<&dyn IsMenuItem> = owned.iter().collect();
        Some(Submenu::with_items(app, &refs, "扩展")?)
    } else {
        None
    };

    let mut items: Vec<&dyn IsMenuItem> = vec![&toggle, &next, &prev, &separator, &show];
    if let Some(sub) = &sub {
        items.push(sub);
    }
    items.push(&quit);

    let menu = Menu::with_items(app, &items)?;

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
            id if id.starts_with("ext:") => extension::handle_tray_event(app, id),
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
